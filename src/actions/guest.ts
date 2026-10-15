"use server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { runAction, parseForm, UserError, type ActionResult } from "@/server/errors";
import { consumeToken, createSession, hashPassword, passwordPolicy } from "@/server/auth";
import { clientIp, audit } from "@/server/audit";
import { rateLimit } from "@/server/rate-limit";
import { notify } from "@/server/notifications";
import { startMembershipCheckout } from "@/server/memberships";
import { startPayment } from "@/server/payments/service";
import { checkMemberPayment } from "@/server/payments/mpesa-pull";
import { claimPaybillPayment } from "@/server/payments/claim";
import { findOrCreatePendingUser, guestCheckoutPath, hasPaidOrder, isPendingAccount, isRegistrationOrder, isShopOrder, sendAccountSetupEmail, verifyGuestOrderKey } from "@/server/account-setup";

const id = z.string().min(1).max(40);
const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);
const name = z.string().trim().min(2, "Enter your full name").max(120);
const phone = z.string().trim().min(9, "Enter your M-Pesa number").max(20);

async function guestOrder(orderId: string, key: string) {
  if (!verifyGuestOrderKey(orderId, key)) throw new UserError("This payment link is not valid.");
  const order = await prisma.order.findUnique({ where: { id: id.parse(orderId) }, include: { user: true, items: { select: { eventRegistrationItemId: true, type: true } } } });
  // Event-form and shop orders are paid through the customer's signed link whether or not they have an account.
  if (!order || !(isPendingAccount(order.user) || isRegistrationOrder(order) || isShopOrder(order))) throw new UserError("This payment link is not valid. Sign in to pay for your order.");
  return order;
}

/** Visitor without an account: capture details, create a pending account and the order. */
export async function guestCheckoutAction(planId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const data = parseForm(z.object({ name, email, phone, terms: z.literal("on", { message: "Please accept the club rules" }) }), formData);
    if (!(await rateLimit(`guest-checkout:${await clientIp()}`, 10, 3600))) throw new UserError("Too many attempts from this network. Please try again later.");
    const user = await findOrCreatePendingUser(data);
    const order = await startMembershipCheckout(user.id, id.parse(planId));
    return { ok: true, message: "Order created", redirect: guestCheckoutPath(order.id) };
  });
}

export async function guestPayAction(orderId: string, key: string, formData: FormData): Promise<ActionResult<{ paymentId: string }>> {
  return runAction(async () => {
    const order = await guestOrder(orderId, key);
    const { phone: input } = parseForm(z.object({ phone }), formData);
    const payment = await startPayment(order.userId, order.id, input);
    return { ok: true, message: "Check your phone and enter your M-Pesa PIN.", data: { paymentId: payment.id } };
  });
}

export async function guestCheckPaymentAction(orderId: string, key: string, paymentId: string): Promise<ActionResult<{ status: string; receipt: string | null; failureReason: string | null }>> {
  return runAction(async () => {
    const order = await guestOrder(orderId, key);
    if (!(await rateLimit(`paycheck:${order.userId}`, 10, 600))) throw new UserError("Please wait a minute before checking again.");
    const payment = await checkMemberPayment(id.parse(paymentId), order.userId);
    if (!payment || payment.orderId !== order.id) throw new UserError("Payment not found.");
    const message = payment.status === "SUCCESS" ? "Payment confirmed by M-Pesa." : "M-Pesa hasn't confirmed this payment yet.";
    return { ok: true, message, data: { status: payment.status, receipt: payment.receiptNumber, failureReason: payment.failureReason } };
  });
}

/** Paid at the Paybill directly: exchange the M-Pesa code for a registration link. */
export async function claimPaymentAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const data = parseForm(
      z.object({
        code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/, "M-Pesa codes are 10 letters and numbers, e.g. TJK3AB12CD"),
        planId: id,
        name,
        email,
        phone,
      }),
      formData,
    );
    if (!(await rateLimit(`claim:${await clientIp()}`, 8, 3600))) throw new UserError("Too many attempts. Please try again later or contact the club.");
    const result = await claimPaybillPayment(data);
    if (result.resent) return { ok: true, message: "That code is already registered. If it's yours and not yet set up, we've re-sent the registration link to the email used at payment." };
    return { ok: true, message: `Payment verified — ${result.planName} is active. We've emailed a registration link to ${result.email}.`, redirect: `/claim?done=${encodeURIComponent(result.email)}` };
  });
}

export async function completeRegistrationAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const data = parseForm(
      z.object({ token: z.string().min(10), password: z.string().max(200).refine(passwordPolicy.test, passwordPolicy.message), confirm: z.string() }).refine((d) => d.password === d.confirm, { message: "Passwords do not match", path: ["confirm"] }),
      formData,
    );
    const userId = await consumeToken(data.token, "ACCOUNT_SETUP");
    if (!userId) throw new UserError("This registration link is invalid, used or expired. Request a new one below.");
    const { count } = await prisma.user.updateMany({ where: { id: userId, passwordHash: "" }, data: { passwordHash: await hashPassword(data.password), emailVerifiedAt: new Date() } });
    if (!count) throw new UserError("This account is already set up. Please sign in.");
    await notify({ userId, type: "REGISTRATION", title: "Welcome to the clubhouse", body: "Your account is ready and your membership is active.", link: "/dashboard/membership" });
    await audit({ actorId: userId, action: "user.register_after_payment", entity: "User", entityId: userId });
    await createSession(userId);
    return { ok: true, message: "Your account is ready.", redirect: "/dashboard/membership" };
  });
}

export async function resendSetupLinkAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const data = parseForm(z.object({ email }), formData);
    if (!(await rateLimit(`setup-resend:${data.email}`, 3, 3600)) || !(await rateLimit(`setup-resend:${await clientIp()}`, 10, 3600))) throw new UserError("Please wait before requesting another link.");
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (user && isPendingAccount(user) && (await hasPaidOrder(user.id))) await sendAccountSetupEmail(user.id);
    return { ok: true, message: "If that email has a paid membership waiting, a new registration link is on its way." };
  });
}
