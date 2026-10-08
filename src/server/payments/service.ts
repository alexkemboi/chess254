import "server-only";
import { Prisma, type PaymentStatus } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import { UserError } from "@/server/errors";
import { randomToken, sha256 } from "@/server/crypto";
import { rateLimit } from "@/server/rate-limit";
import { getAllSettings } from "@/server/settings";
import { nextInvoiceNumber, releaseOrderHolds } from "@/server/orders";
import { fulfilMembership } from "@/server/memberships";
import { confirmPaidBooking } from "@/server/booking";
import { confirmPaidRegistration } from "@/server/events";
import { fulfilService } from "@/server/services";
import { alertAdmins, emailNotifications, notify } from "@/server/notifications";
import { audit } from "@/server/audit";
import { formatMoney } from "@/lib/format";
import { activeProvider, providerImplementation } from "./registry";
import type { ProviderOutcome } from "./types";

const OPEN: PaymentStatus[] = ["PENDING", "PROCESSING"];
/** Real money arriving after we gave up on a payment must still be honoured. */
const SETTLEABLE: PaymentStatus[] = ["PENDING", "PROCESSING", "EXPIRED"];

type Source = "CALLBACK" | "QUERY" | "MANUAL";

function chargeAmount(total: Prisma.Decimal) {
  return Math.ceil(total.toNumber());
}

// ─── Initiation ───────────────────────────────────────────────────────────

export async function startPayment(userId: string, orderId: string, phoneInput: string) {
  if (!(await rateLimit(`pay:${userId}`, 6, 600))) throw new UserError("Too many payment attempts. Please wait a few minutes and try again.");
  const provider = await activeProvider();
  if (!provider) throw new UserError("Online payments are not available right now. Please contact the club.");
  const readiness = await provider.impl.readiness();
  if (!readiness.ready) {
    console.warn(`[payments] ${provider.row.key} not ready: ${readiness.missing.join(", ")}`);
    throw new UserError("Online payments are temporarily unavailable. Please try again later.");
  }
  const phone = provider.impl.normalizePhone(phoneInput);
  if (!phone) throw new UserError("Enter a valid M-Pesa number, e.g. 0712 345 678.", { phone: "Enter a valid Safaricom number" });

  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, include: { items: true, payments: { orderBy: { createdAt: "desc" } } } });
  if (!order) throw new UserError("Order not found.");
  if (order.status === "PAID") throw new UserError("This order has already been paid.");
  if (order.status !== "PENDING") throw new UserError("This order is no longer payable. Please start again.");
  const config = await prisma.paymentConfiguration.findUnique({ where: { providerId: provider.row.id } });
  const timeoutMinutes = config?.timeoutMinutes ?? 5;
  if (order.expiresAt && order.expiresAt < new Date() && !order.payments.some((p) => p.status === "PROCESSING")) {
    await expireOrder(order.id);
    throw new UserError("This order has expired. Please start again.");
  }

  const inFlight = order.payments.find((p) => p.status === "PROCESSING" && p.createdAt.getTime() > Date.now() - timeoutMinutes * 60_000);
  if (inFlight) return inFlight;

  const amount = chargeAmount(order.total);
  if (amount <= 0) throw new UserError("Nothing to pay for this order.");
  const accountReference = await provider.impl.formatAccountReference(order.number);
  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        orderId: order.id,
        userId,
        providerId: provider.row.id,
        amount,
        currency: order.currency,
        phoneNumber: phone,
        accountReference,
        idempotencyKey: `${order.id}:${randomToken(9)}`,
        status: "PENDING",
      },
    });
    // Keep holds alive while the customer approves the prompt on their phone.
    const holdUntil = new Date(Date.now() + (timeoutMinutes + 2) * 60_000);
    await tx.order.updateMany({ where: { id: order.id, OR: [{ expiresAt: null }, { expiresAt: { lt: holdUntil } }] }, data: { expiresAt: holdUntil } });
    for (const item of order.items) {
      if (item.bookingId) await tx.booking.updateMany({ where: { id: item.bookingId, status: "PENDING", holdExpiresAt: { lt: holdUntil } }, data: { holdExpiresAt: holdUntil } });
      if (item.eventRegistrationId) await tx.eventRegistration.updateMany({ where: { id: item.eventRegistrationId, status: "PENDING", holdExpiresAt: { lt: holdUntil } }, data: { holdExpiresAt: holdUntil } });
    }
    return created;
  });

  const settings = await getAllSettings();
  const result = await provider.impl.initiate({
    paymentId: payment.id,
    amount,
    currency: order.currency,
    phone,
    accountReference,
    description: config?.transactionDescription || settings.general.siteName,
  });

  if (result.ok) {
    return prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "PROCESSING",
        checkoutRequestId: result.checkoutRequestId,
        merchantRequestId: result.merchantRequestId,
        transactions: { create: { kind: "INITIATE", status: "PROCESSING", reference: result.checkoutRequestId, message: result.customerMessage, raw: result.raw as Prisma.InputJsonValue } },
      },
    });
  }
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "FAILED", failureReason: result.message, transactions: { create: { kind: "INITIATE", status: "FAILED", message: result.message, raw: result.raw as Prisma.InputJsonValue } } },
  });
  throw new UserError(`M-Pesa could not start the payment: ${result.message}`);
}

// ─── Settlement ───────────────────────────────────────────────────────────

/**
 * Applies a verified provider outcome. The conditional status update means only
 * the first caller transitions the payment, so repeated callbacks, concurrent
 * queries and retries can never fulfil an order twice.
 */
export async function applyOutcome(paymentId: string, outcome: ProviderOutcome, source: Source, actorId?: string) {
  const settings = await getAllSettings();
  const timezone = settings.general.timezone;

  if (outcome.status === "PENDING") {
    await prisma.payment.update({
      where: { id: paymentId },
      data: { lastQueriedAt: new Date(), transactions: { create: { kind: source, status: "PROCESSING", message: outcome.message, raw: outcome.raw as Prisma.InputJsonValue, actorId } } },
    });
    return { changed: false as const, status: "PROCESSING" as const };
  }

  const refunds: string[] = [];
  const result = await prisma.$transaction(
    async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { order: { include: { items: true } } } });

      if (outcome.status === "SUCCESS") {
        if (outcome.amount !== undefined && Math.round(outcome.amount) !== Math.round(payment.amount.toNumber())) {
          await tx.paymentTransaction.create({ data: { paymentId, kind: source, status: payment.status, message: `Amount mismatch: expected ${payment.amount}, received ${outcome.amount}`, raw: outcome.raw as Prisma.InputJsonValue, actorId } });
          return { changed: false as const, status: payment.status, mismatch: true, notificationIds: [] as string[] };
        }
        const { count } = await tx.payment.updateMany({
          where: { id: paymentId, status: { in: SETTLEABLE } },
          data: {
            status: "SUCCESS",
            completedAt: new Date(),
            resultCode: outcome.resultCode ?? payment.resultCode,
            receiptNumber: outcome.receiptNumber ?? payment.receiptNumber,
            transactionReference: outcome.receiptNumber ?? payment.transactionReference,
            failureReason: null,
            lastQueriedAt: source === "QUERY" ? new Date() : undefined,
          },
        });
        await tx.paymentTransaction.create({ data: { paymentId, kind: source, status: "SUCCESS", reference: outcome.receiptNumber, message: outcome.message, raw: outcome.raw as Prisma.InputJsonValue, actorId } });
        if (count === 0) {
          // Already settled. A later callback may still carry the receipt number a status query lacked.
          if (outcome.receiptNumber && !payment.receiptNumber && payment.status === "SUCCESS") {
            await tx.payment.update({ where: { id: paymentId }, data: { receiptNumber: outcome.receiptNumber, transactionReference: outcome.receiptNumber } });
          }
          return { changed: false as const, status: payment.status, notificationIds: [] as string[] };
        }
        const notificationIds = await fulfilOrder(tx, payment.orderId, paymentId, timezone, refunds);
        const n = await notify(
          { userId: payment.userId, type: "PAYMENT_CONFIRMED", title: "Payment received", body: `We received ${formatMoney(payment.amount, payment.currency)}${outcome.receiptNumber ? ` (M-Pesa ${outcome.receiptNumber})` : ""} for order ${payment.order.number}.`, link: `/dashboard/payments` },
          tx,
        );
        return { changed: true as const, status: "SUCCESS" as const, notificationIds: [...notificationIds, n.id] };
      }

      const status: PaymentStatus = outcome.status === "CANCELLED" ? "CANCELLED" : "FAILED";
      const { count } = await tx.payment.updateMany({
        where: { id: paymentId, status: { in: OPEN } },
        data: { status, resultCode: outcome.resultCode, failureReason: outcome.message ?? "Payment was not completed", completedAt: new Date(), lastQueriedAt: source === "QUERY" ? new Date() : undefined },
      });
      await tx.paymentTransaction.create({ data: { paymentId, kind: source, status, reference: outcome.resultCode, message: outcome.message, raw: outcome.raw as Prisma.InputJsonValue, actorId } });
      if (count === 0) return { changed: false as const, status: payment.status, notificationIds: [] as string[] };
      const n = await notify(
        { userId: payment.userId, type: "PAYMENT_FAILED", title: status === "CANCELLED" ? "Payment cancelled" : "Payment not completed", body: `${outcome.message ?? "The M-Pesa payment did not go through."} You can try again from your dashboard while the order is open.`, link: `/pay/${payment.orderId}` },
        tx,
      );
      return { changed: true as const, status, notificationIds: [n.id] };
    },
    { timeout: 30_000 },
  );

  if (result.notificationIds.length) await emailNotifications(result.notificationIds).catch((e) => console.error("[payments] email", e));
  if ("mismatch" in result && result.mismatch) await alertAdmins("Payment amount mismatch", `Payment ${paymentId} reported a different amount than requested. Reconcile manually.`, `/admin/payments/${paymentId}`);
  for (const message of refunds) await alertAdmins("Refund required", message, `/admin/payments/${paymentId}`);
  return result;
}

async function fulfilOrder(tx: Tx, orderId: string, paymentId: string, timezone: string, refunds: string[]) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, invoice: true } });
  await tx.order.update({ where: { id: orderId }, data: { status: "PAID", paidAt: order.paidAt ?? new Date() } });
  if (!order.invoice) {
    await tx.invoice.create({ data: { number: await nextInvoiceNumber(tx), orderId, paymentId, subtotal: order.subtotal, tax: order.tax, total: order.total, currency: order.currency } });
  }
  const ids: string[] = [];
  for (const item of order.items) {
    if (item.fulfilledAt) continue;
    let done = true;
    if (item.type === "MEMBERSHIP" && item.membershipPlanId) {
      const n = await fulfilMembership(tx, { userId: order.userId, planId: item.membershipPlanId, orderItemId: item.id, paymentId, timezone });
      if (n) ids.push(n.id);
    } else if (item.type === "BOOKING" && item.bookingId) {
      const r = await confirmPaidBooking(tx, item.bookingId);
      done = r.ok;
      if (r.ok) ids.push((await notify({ userId: order.userId, type: "BOOKING_CONFIRMED", title: "Booking confirmed", body: `${item.description} is confirmed.`, link: "/dashboard/bookings" }, tx)).id);
      else {
        refunds.push(`Order ${order.number}: ${item.description} — ${r.reason}.`);
        ids.push((await notify({ userId: order.userId, type: "BOOKING_CANCELLED", title: "We couldn't hold your slot", body: `${item.description} was taken before your payment arrived. The club will refund you.`, link: "/dashboard/payments" }, tx)).id);
      }
    } else if (item.type === "EVENT" && item.eventRegistrationId) {
      const r = await confirmPaidRegistration(tx, item.eventRegistrationId);
      done = r.ok;
      if (r.ok) ids.push((await notify({ userId: order.userId, type: "EVENT_REGISTERED", title: "Registration confirmed", body: `${item.description} is confirmed.`, link: "/dashboard/events" }, tx)).id);
      else {
        refunds.push(`Order ${order.number}: ${item.description} — ${r.reason}.`);
        ids.push((await notify({ userId: order.userId, type: "PAYMENT_CONFIRMED", title: "Event full", body: `${item.description} filled up before your payment arrived. The club will refund you.`, link: "/dashboard/payments" }, tx)).id);
      }
    } else if (item.type === "SERVICE" && item.servicePurchaseId) {
      const n = await fulfilService(tx, item.servicePurchaseId);
      if (n) ids.push(n.id);
    }
    if (done) await tx.orderItem.update({ where: { id: item.id }, data: { fulfilledAt: new Date() } });
  }
  return ids;
}

// ─── Callbacks ────────────────────────────────────────────────────────────

export async function handleProviderCallback(providerKey: string, body: unknown, sourceIp: string) {
  const impl = providerImplementation(providerKey);
  const row = await prisma.paymentProvider.findUnique({ where: { key: providerKey }, include: { config: true } });
  if (!impl || !row) return { accepted: false, outcome: "unknown-provider" };

  const allowed = row.config?.allowedCallbackIps ?? [];
  const parsed = impl.parseCallback(body);
  const eventKey = parsed?.eventKey ?? `invalid:${sha256(JSON.stringify(body ?? null)).slice(0, 40)}`;

  // The unique eventKey makes delivery idempotent: a repeat delivery inserts nothing.
  // A repeat whose first delivery never finished processing (crash) is resumed.
  await prisma.paymentCallback.createMany({ data: [{ providerKey, eventKey, payload: (body ?? {}) as Prisma.InputJsonValue, sourceIp }], skipDuplicates: true });
  const callback = await prisma.paymentCallback.findUnique({ where: { eventKey } });
  if (!callback || callback.processedAt) return { accepted: true, outcome: "duplicate" };
  const claim = await prisma.paymentCallback.updateMany({
    where: { id: callback.id, processedAt: null, OR: [{ outcome: null }, { outcome: "processing", receivedAt: { lt: new Date(Date.now() - 120_000) } }] },
    data: { outcome: "processing" },
  });
  if (claim.count === 0) return { accepted: true, outcome: "duplicate" };

  const finish = (outcome: string, extra: { verified?: boolean; paymentId?: string } = {}) =>
    prisma.paymentCallback.update({ where: { id: callback.id }, data: { outcome, processedAt: new Date(), verified: extra.verified ?? false, paymentId: extra.paymentId } }).then(() => ({ accepted: true, outcome }));

  if (allowed.length && !allowed.includes(sourceIp)) return finish("rejected-ip");
  if (!parsed) return finish("unparseable");

  const payment = await prisma.payment.findUnique({ where: { checkoutRequestId: parsed.checkoutRequestId } });
  if (!payment || payment.providerId !== row.id) return finish("unknown-payment");
  if (parsed.merchantRequestId && payment.merchantRequestId && parsed.merchantRequestId !== payment.merchantRequestId) return finish("merchant-mismatch", { paymentId: payment.id });

  let outcome = parsed.outcome;
  if (outcome.status === "SUCCESS" && (row.config?.verifyWithQuery ?? true)) {
    const confirmed = await impl.query(parsed.checkoutRequestId);
    if (confirmed.status === "PENDING") return finish("awaiting-confirmation", { paymentId: payment.id });
    if (confirmed.status !== "SUCCESS") {
      await alertAdmins("Payment callback disputed", `A success callback for payment ${payment.id} was contradicted by the provider status query.`, `/admin/payments/${payment.id}`);
      return finish("query-disagrees", { paymentId: payment.id });
    }
    outcome = { ...outcome, raw: { callback: parsed.outcome.raw, query: confirmed.raw } };
  }

  await applyOutcome(payment.id, outcome, "CALLBACK");
  return finish(outcome.status.toLowerCase(), { verified: true, paymentId: payment.id });
}

// ─── Reconciliation & expiry ──────────────────────────────────────────────

export async function reconcilePayment(paymentId: string, actorId?: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { provider: true } });
  if (!payment?.checkoutRequestId) return null;
  if (!["PENDING", "PROCESSING", "EXPIRED"].includes(payment.status)) return payment.status;
  const impl = providerImplementation(payment.provider.key);
  if (!impl) return payment.status;
  const outcome = await impl.query(payment.checkoutRequestId);
  const result = await applyOutcome(payment.id, outcome, "QUERY", actorId);
  return result.status;
}

/** Customer status polling with throttled provider queries (covers missed callbacks). */
export async function pollPayment(paymentId: string, userId: string) {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, userId }, include: { order: { select: { id: true, status: true, number: true } } } });
  if (!payment) return null;
  const age = Date.now() - payment.createdAt.getTime();
  const sinceQuery = payment.lastQueriedAt ? Date.now() - payment.lastQueriedAt.getTime() : Infinity;
  if (payment.status === "PROCESSING" && age > 25_000 && sinceQuery > 15_000) {
    await prisma.payment.update({ where: { id: payment.id }, data: { lastQueriedAt: new Date() } });
    await reconcilePayment(payment.id).catch((e) => console.error("[payments] poll reconcile", e));
    return prisma.payment.findUnique({ where: { id: payment.id }, include: { order: { select: { id: true, status: true, number: true } } } });
  }
  return payment;
}

export async function expireOrder(orderId: string) {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.order.updateMany({ where: { id: orderId, status: "PENDING" }, data: { status: "EXPIRED" } });
    if (count) await releaseOrderHolds(tx, orderId, "EXPIRED");
  });
}

/** Periodic job: query stuck payments, expire abandoned ones and lapsed orders. */
export async function sweepPayments() {
  const now = Date.now();
  const configs = await prisma.paymentConfiguration.findMany();
  const timeoutFor = (providerId: string) => (configs.find((c) => c.providerId === providerId)?.timeoutMinutes ?? 5) * 60_000;
  const stuck = await prisma.payment.findMany({ where: { status: { in: OPEN } }, take: 100, orderBy: { createdAt: "asc" } });
  let reconciled = 0;
  let expired = 0;
  for (const p of stuck) {
    const age = now - p.createdAt.getTime();
    if (age < timeoutFor(p.providerId)) continue;
    if (p.checkoutRequestId) {
      const status = await reconcilePayment(p.id).catch(() => null);
      reconciled++;
      if (status && status !== "PROCESSING" && status !== "PENDING") continue;
    }
    if (age > timeoutFor(p.providerId) * 3) {
      const { count } = await prisma.payment.updateMany({ where: { id: p.id, status: { in: OPEN } }, data: { status: "EXPIRED", failureReason: "No confirmation received from the provider" } });
      if (count) {
        expired++;
        await prisma.paymentTransaction.create({ data: { paymentId: p.id, kind: "EXPIRE", status: "EXPIRED", message: "Timed out" } });
      }
    }
  }
  const lapsed = await prisma.order.findMany({
    where: { status: "PENDING", expiresAt: { lt: new Date() }, payments: { none: { status: "PROCESSING" } } },
    select: { id: true },
    take: 200,
  });
  for (const o of lapsed) await expireOrder(o.id);
  return { reconciled, expired, ordersExpired: lapsed.length };
}

/** Super-admin manual settlement (e.g. confirmed on the M-Pesa portal), fully audited. */
export async function settleManually(paymentId: string, actorId: string, receiptNumber: string, note: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new UserError("Payment not found.");
  if (!SETTLEABLE.includes(payment.status) && payment.status !== "FAILED" && payment.status !== "CANCELLED") throw new UserError(`Payment is already ${payment.status.toLowerCase()}.`);
  if (payment.status === "FAILED" || payment.status === "CANCELLED") {
    await prisma.payment.update({ where: { id: paymentId }, data: { status: "PROCESSING" } });
  }
  const result = await applyOutcome(paymentId, { status: "SUCCESS", receiptNumber, message: `Manually reconciled: ${note}`, raw: { manual: true, note } }, "MANUAL", actorId);
  await audit({ actorId, action: "payment.manual_settle", entity: "Payment", entityId: paymentId, previous: { status: payment.status }, next: { status: "SUCCESS", receiptNumber, note } });
  return result;
}
