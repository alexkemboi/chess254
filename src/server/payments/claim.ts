import "server-only";
import { prisma } from "@/server/db";
import { UserError } from "@/server/errors";
import { randomToken } from "@/server/crypto";
import { rateLimit } from "@/server/rate-limit";
import { startMembershipCheckout } from "@/server/memberships";
import { findOrCreatePendingUser, isPendingAccount, sendAccountSetupEmail } from "@/server/account-setup";
import { MpesaPaymentProvider, MPESA_PROVIDER_KEY } from "./mpesa";
import { pullStatus, syncPulledTransactions } from "./mpesa-pull";
import { applyOutcome } from "./service";

const NOT_FOUND = "We couldn't find an unused payment with that M-Pesa code. Payments can take a few minutes to appear — please try again shortly, or contact the club.";

/**
 * Pay-first sign-up for someone who paid at the Paybill directly: the M-Pesa
 * code is looked up in the transactions read from Safaricom, checked against
 * the chosen plan's price (and the paying phone where M-Pesa reveals it), then
 * turned into a paid membership on a pending account with a registration link.
 */
export async function claimPaybillPayment(input: { code: string; planId: string; name: string; email: string; phone: string }) {
  const code = input.code.trim().toUpperCase();
  const msisdn = new MpesaPaymentProvider().normalizePhone(input.phone);
  if (!msisdn) throw new UserError("Enter the Safaricom number you paid with.", { phone: "Enter a valid Safaricom number" });

  // Already used: never reveal whose it is; resend the link to the payer's own email if still pending.
  const used = await prisma.payment.findUnique({ where: { receiptNumber: code }, include: { user: true } });
  if (used) {
    if (isPendingAccount(used.user)) await sendAccountSetupEmail(used.userId);
    return { resent: true as const };
  }

  let row = await prisma.mpesaTransaction.findUnique({ where: { transactionId: code } });
  if (!row && (await pullStatus()).active && (await rateLimit("mpesa-pull:claim", 1, 30))) {
    await syncPulledTransactions().catch((e) => console.error("[claim] pull", e));
    row = await prisma.mpesaTransaction.findUnique({ where: { transactionId: code } });
  }
  if (!row || row.matchStatus !== "UNMATCHED") throw new UserError(NOT_FOUND);

  // M-Pesa often masks the number (2547****149); compare whatever digits it shows at the end.
  const shown = (row.msisdn ?? "").replace(/\D/g, "");
  const tail = shown.slice(-3);
  if (tail.length === 3 && !msisdn.endsWith(tail)) throw new UserError(NOT_FOUND);

  const plan = await prisma.membershipPlan.findFirst({ where: { id: input.planId, status: "ACTIVE" } });
  if (!plan) throw new UserError("Choose a membership plan.");
  const amount = Math.round(row.amount.toNumber());

  // Claim the transaction first so two people can't use one code at the same time.
  const { count } = await prisma.mpesaTransaction.updateMany({ where: { id: row.id, matchStatus: "UNMATCHED" }, data: { matchStatus: "CLAIMING" } });
  if (!count) throw new UserError(NOT_FOUND);
  try {
    const user = await findOrCreatePendingUser({ name: input.name, email: input.email, phone: msisdn });
    const order = await startMembershipCheckout(user.id, plan.id);
    if (Math.ceil(order.total.toNumber()) !== amount) {
      throw new UserError(`That payment was KSh ${amount.toLocaleString("en-KE")}, which doesn't match ${plan.name}. Choose the plan you paid for, or contact the club.`, { planId: "Amount doesn't match this plan" });
    }
    const provider = await prisma.paymentProvider.findUniqueOrThrow({ where: { key: MPESA_PROVIDER_KEY } });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        userId: user.id,
        providerId: provider.id,
        amount,
        currency: order.currency,
        phoneNumber: msisdn,
        accountReference: row.billReference || code,
        idempotencyKey: `${order.id}:claim:${randomToken(6)}`,
        status: "PROCESSING",
      },
    });
    const result = await applyOutcome(payment.id, { status: "SUCCESS", receiptNumber: code, amount, message: "Claimed with M-Pesa code (Paybill payment)", raw: { pull: row.raw } }, "PULL");
    if (result.status !== "SUCCESS") throw new UserError("We couldn't apply that payment. Please contact the club.");
    await prisma.mpesaTransaction.update({ where: { id: row.id }, data: { matchStatus: "SETTLED", paymentId: payment.id, note: `Claimed for ${plan.name}` } });
    return { resent: false as const, email: user.email, planName: plan.name };
  } catch (error) {
    await prisma.mpesaTransaction.updateMany({ where: { id: row.id, matchStatus: "CLAIMING" }, data: { matchStatus: "UNMATCHED" } });
    throw error;
  }
}
