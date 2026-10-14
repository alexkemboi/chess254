import "server-only";
import { Prisma, type PaymentStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { rateLimit } from "@/server/rate-limit";
import { alertAdmins } from "@/server/notifications";
import { MpesaPaymentProvider, mpesaConfig } from "./mpesa";
import { applyOutcome, reconcilePayment } from "./service";

/** Daraja only serves roughly the last 48 hours of transactions. */
const MAX_WINDOW_MS = 48 * 3600_000;
/** Re-read a little before the last sync so late-posted transactions are not missed. */
const OVERLAP_MS = 30 * 60_000;
/** Unmatched transactions are retried for a week (e.g. the order is created after a manual paybill payment). */
const RETRY_MATCH_MS = 7 * 86400_000;

const RETRYABLE: PaymentStatus[] = ["FAILED", "CANCELLED"];
const SETTLEABLE: PaymentStatus[] = ["PENDING", "PROCESSING", "EXPIRED"];

export async function pullStatus() {
  const { provider, config } = await mpesaConfig();
  return {
    provider,
    config,
    active: Boolean(provider?.enabled && config?.pullEnabled && config.pullRegisteredAt),
  };
}

/** Registers the shortcode with the Pull Transactions API (needed once per shortcode). */
export async function registerPullShortcode() {
  const { config } = await mpesaConfig();
  if (!config) return { ok: false, message: "Save the M-Pesa settings first.", raw: null };
  const result = await new MpesaPaymentProvider().registerPull();
  if (result.ok) await prisma.paymentConfiguration.update({ where: { id: config.id }, data: { pullRegisteredAt: new Date() } });
  return result;
}

/**
 * Fetches payments received on the shortcode, stores each once (keyed by the
 * M-Pesa receipt) and settles the matching orders. Safe to run concurrently:
 * inserts skip duplicates and settlement goes through the idempotent applyOutcome.
 */
export async function syncPulledTransactions(opts: { from?: Date; to?: Date } = {}) {
  const { config } = await mpesaConfig();
  if (!config) throw new Error("M-Pesa is not configured");
  const impl = new MpesaPaymentProvider();
  const readiness = await impl.readiness();
  if (!readiness.ready) throw new Error(`M-Pesa is not ready: ${readiness.missing.join(", ")}`);

  const to = opts.to ?? new Date();
  const floor = new Date(to.getTime() - MAX_WINDOW_MS);
  const defaultFrom = config.pullLastSyncedAt ? new Date(config.pullLastSyncedAt.getTime() - OVERLAP_MS) : floor;
  const from = new Date(Math.max((opts.from ?? defaultFrom).getTime(), floor.getTime()));

  const rows = await impl.pullTransactions(from, to);
  const shortcode = config.pullShortcode || config.shortcode || "";
  const { count: created } = await prisma.mpesaTransaction.createMany({
    data: rows.map((r) => ({
      transactionId: r.transactionId,
      shortcode,
      transactionDate: r.transactionDate,
      msisdn: r.msisdn,
      sender: r.sender,
      transactionType: r.transactionType,
      billReference: r.billReference,
      amount: r.amount,
      organizationName: r.organizationName,
      raw: r.raw as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });
  if (!opts.from) await prisma.paymentConfiguration.update({ where: { id: config.id }, data: { pullLastSyncedAt: to } });

  const matching = await matchUnmatchedTransactions();
  return { pulled: rows.length, created, ...matching };
}

export async function matchUnmatchedTransactions() {
  const pending = await prisma.mpesaTransaction.findMany({
    where: { matchStatus: "UNMATCHED", transactionDate: { gt: new Date(Date.now() - RETRY_MATCH_MS) } },
    orderBy: { transactionDate: "asc" },
    take: 500,
  });
  let settled = 0;
  let matched = 0;
  for (const row of pending) {
    try {
      const result = await matchTransaction(row.id);
      if (result === "SETTLED") settled++;
      if (result === "MATCHED") matched++;
    } catch (error) {
      console.error("[mpesa pull] match", row.transactionId, error);
    }
  }
  return { settled, matched };
}

async function markRow(id: string, matchStatus: string, paymentId: string | null, note: string | null) {
  await prisma.mpesaTransaction.update({ where: { id }, data: { matchStatus, paymentId, note } });
  return matchStatus;
}

/** Links one pulled transaction to its payment, settling the order when money arrived for an unpaid one. */
export async function matchTransaction(rowId: string) {
  const row = await prisma.mpesaTransaction.findUniqueOrThrow({ where: { id: rowId } });
  if (row.matchStatus !== "UNMATCHED") return row.matchStatus;

  // Already recorded, e.g. by the STK callback.
  const byReceipt = await prisma.payment.findUnique({ where: { receiptNumber: row.transactionId } });
  if (byReceipt) return markRow(row.id, "MATCHED", byReceipt.id, null);

  const reference = row.billReference?.trim();
  if (!reference) return markRow(row.id, "UNMATCHED", null, "No account reference");

  const candidates = await prisma.payment.findMany({
    where: { accountReference: { equals: reference, mode: "insensitive" }, createdAt: { lte: new Date(row.transactionDate.getTime() + 10 * 60_000) } },
    include: { order: { select: { id: true, number: true, status: true } } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  if (!candidates.length) return markRow(row.id, "UNMATCHED", null, `No payment with reference ${reference}`);

  const amount = Math.round(row.amount.toNumber());
  const sameAmount = candidates.filter((p) => Math.round(p.amount.toNumber()) === amount);
  if (!sameAmount.length) return markRow(row.id, "UNMATCHED", null, `Amount ${amount} does not match order ${candidates[0].order.number}`);

  const paid = sameAmount.find((p) => p.status === "SUCCESS");
  if (paid) {
    if (!paid.receiptNumber) {
      // Settled by a status query that carried no receipt: this transaction is that money.
      await prisma.payment.update({ where: { id: paid.id }, data: { receiptNumber: row.transactionId, transactionReference: row.transactionId } });
      return markRow(row.id, "MATCHED", paid.id, null);
    }
    await alertAdmins("Possible duplicate M-Pesa payment", `M-Pesa ${row.transactionId} (${amount}) references order ${paid.order.number}, which was already paid with ${paid.receiptNumber}. Check whether a refund is due.`, "/admin/mpesa-transactions?status=UNMATCHED");
    return markRow(row.id, "UNMATCHED", null, `Order ${paid.order.number} already paid with ${paid.receiptNumber} — possible duplicate`);
  }

  const target = sameAmount.find((p) => SETTLEABLE.includes(p.status)) ?? sameAmount.find((p) => RETRYABLE.includes(p.status));
  if (!target) return markRow(row.id, "UNMATCHED", null, `Order ${sameAmount[0].order.number} is ${sameAmount[0].status.toLowerCase()}`);

  // A prompt that failed or was cancelled can still be followed by a manual paybill payment with the same reference.
  if (RETRYABLE.includes(target.status)) {
    await prisma.payment.updateMany({ where: { id: target.id, status: target.status }, data: { status: "PROCESSING" } });
  }
  const result = await applyOutcome(
    target.id,
    { status: "SUCCESS", receiptNumber: row.transactionId, amount, message: "Confirmed by M-Pesa transaction pull", raw: { pull: row.raw } },
    "PULL",
  );
  if (result.status === "SUCCESS") return markRow(row.id, "SETTLED", target.id, null);
  return markRow(row.id, "UNMATCHED", null, `Could not settle order ${target.order.number} (${String(result.status).toLowerCase()})`);
}

/** Scheduled sync; no-op unless pulling is enabled and registered. */
export async function syncPulledTransactionsIfEnabled() {
  const { active } = await pullStatus();
  if (!active) return null;
  try {
    return await syncPulledTransactions();
  } catch (error) {
    console.error("[mpesa pull] sync", error);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Member-triggered check: asks M-Pesa for the STK status, and if that is not
 * conclusive, pulls recent transactions in case the money arrived another way.
 */
export async function checkMemberPayment(paymentId: string, userId: string) {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, userId } });
  if (!payment) return null;
  if (payment.status === "SUCCESS" || payment.status === "REFUNDED") return payment;
  if (payment.checkoutRequestId) await reconcilePayment(payment.id).catch((e) => console.error("[payments] member check", e));
  const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  if (after.status !== "SUCCESS" && (await pullStatus()).active && (await rateLimit("mpesa-pull:member", 1, 60))) {
    await syncPulledTransactions({ from: new Date(payment.createdAt.getTime() - 10 * 60_000) }).catch((e) => console.error("[mpesa pull] member check", e));
  }
  return prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
}

/** Admin: apply an unmatched transaction (e.g. a typo in the account number) to an order. */
export async function linkTransactionToOrder(rowId: string, orderNumber: string, actorId: string) {
  const row = await prisma.mpesaTransaction.findUnique({ where: { id: rowId } });
  if (!row) throw new Error("Transaction not found.");
  if (row.matchStatus === "SETTLED" || row.matchStatus === "MATCHED") throw new Error("This transaction is already linked.");
  if (await prisma.payment.findUnique({ where: { receiptNumber: row.transactionId } })) throw new Error("This receipt is already recorded on a payment.");
  const order = await prisma.order.findUnique({ where: { number: orderNumber.trim().toUpperCase() }, include: { payments: { orderBy: { createdAt: "desc" } } } });
  if (!order) throw new Error("Order not found.");
  if (order.status === "PAID") throw new Error("That order is already paid.");
  const amount = Math.round(row.amount.toNumber());
  if (Math.ceil(order.total.toNumber()) !== amount) throw new Error(`Amount ${amount} does not match the order total ${Math.ceil(order.total.toNumber())}.`);
  const payment = order.payments.find((p) => SETTLEABLE.includes(p.status) || RETRYABLE.includes(p.status));
  if (!payment) throw new Error("The order has no payment attempt to settle. Ask the member to start payment once, then link again.");
  if (RETRYABLE.includes(payment.status)) await prisma.payment.updateMany({ where: { id: payment.id, status: payment.status }, data: { status: "PROCESSING" } });
  const result = await applyOutcome(payment.id, { status: "SUCCESS", receiptNumber: row.transactionId, amount, message: `Linked from M-Pesa transaction pull by an admin`, raw: { pull: row.raw, linkedBy: actorId } }, "MANUAL", actorId);
  if (result.status !== "SUCCESS") throw new Error(`Could not settle the payment (${String(result.status).toLowerCase()}).`);
  await prisma.mpesaTransaction.update({ where: { id: row.id }, data: { matchStatus: "SETTLED", paymentId: payment.id, note: `Linked to ${order.number} manually` } });
  return { paymentId: payment.id, orderNumber: order.number };
}
