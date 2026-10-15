import "server-only";
import { prisma } from "@/server/db";
import { UserError } from "@/server/errors";
import { safeEqual, sha256, signedKey } from "@/server/crypto";
import { issueToken } from "@/server/tokens";
import { sendEmail } from "@/server/notifications";
import { getSettings, siteUrl } from "@/server/settings";

/**
 * Pay-first sign-up. A visitor buying a membership gets a *pending* account:
 * no password (so it cannot sign in) and an unverified email. Once M-Pesa
 * confirms the payment we email a one-time link; opening it proves the email
 * address and lets them choose a password.
 */
export const PENDING_PASSWORD_HASH = "";
const SETUP_LINK_DAYS = 7;

export const isPendingAccount = (user: { passwordHash: string }) => user.passwordHash === PENDING_PASSWORD_HASH;

/** Orders for event-form registration items (paid via the registrant's signed booking link). */
export const isRegistrationOrder = (order: { items: { eventRegistrationItemId: string | null }[] }) => order.items.length > 0 && order.items.every((i) => i.eventRegistrationItemId !== null);

/** Merchandise orders (paid via the customer's signed shop order link). */
export const isShopOrder = (order: { items: { type: string }[] }) => order.items.length > 0 && order.items.every((i) => i.type === "MERCHANDISE");

export function guestOrderKey(orderId: string) {
  return signedKey("guest-order", orderId);
}

export function verifyGuestOrderKey(orderId: string, key: string | null | undefined) {
  return Boolean(key) && safeEqual(key!, guestOrderKey(orderId));
}

export function guestCheckoutPath(orderId: string) {
  return `/checkout/${orderId}?k=${guestOrderKey(orderId)}`;
}

/** Reuses a pending account for the same email, or creates one. Never touches a real account. */
export async function findOrCreatePendingUser(input: { name: string; email: string; phone: string }) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    if (existing.deletedAt || existing.suspendedAt) throw new UserError("This email can't be used. Please contact the club.");
    if (!isPendingAccount(existing)) throw new UserError("This email already has an account. Sign in to buy a membership.", { email: "Already registered — sign in instead" });
    return prisma.user.update({ where: { id: existing.id }, data: { name: input.name, phone: input.phone } });
  }
  return prisma.user.create({
    data: { name: input.name, email: input.email, phone: input.phone, passwordHash: PENDING_PASSWORD_HASH, memberProfile: { create: {} } },
  });
}

/**
 * The account a public form submission (event registration, shop order) belongs to,
 * without ever signing anyone in: the viewer, an existing account with that email,
 * or a new pending account.
 */
export async function findOrCreateContactUser(viewerId: string | null, contact: { name: string; email: string; phone: string }, emailField = "email") {
  if (viewerId) return viewerId;
  const existing = await prisma.user.findUnique({ where: { email: contact.email } });
  if (existing) {
    if (existing.deletedAt || existing.suspendedAt) throw new UserError("This email can't be used. Please contact the club.", { [emailField]: "Use another email" });
    return existing.id;
  }
  const created = await prisma.user.create({
    data: { name: contact.name, email: contact.email, phone: contact.phone || null, passwordHash: PENDING_PASSWORD_HASH, memberProfile: { create: {} } },
  });
  return created.id;
}

export async function hasPaidOrder(userId: string) {
  return (await prisma.payment.count({ where: { userId, status: "SUCCESS" } })) > 0;
}

/** Emails the "complete your registration" link to a pending account that has paid. */
export async function sendAccountSetupEmail(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !isPendingAccount(user) || user.deletedAt) return false;
  const token = await issueToken(user.id, "ACCOUNT_SETUP", SETUP_LINK_DAYS * 24 * 60);
  const { siteName } = await getSettings("general");
  await sendEmail(
    user.email,
    `Complete your ${siteName} registration`,
    `Hi ${user.name.split(" ")[0]}, your payment is confirmed and your membership is active.\n\nChoose a password to finish creating your account. This link is valid for ${SETUP_LINK_DAYS} days and works once.`,
    `${await siteUrl()}/complete-registration?token=${encodeURIComponent(token)}`,
    "Complete registration",
  );
  return true;
}

/** Reads a setup token without using it up (for showing the form). */
export async function peekSetupToken(token: string) {
  const record = await prisma.verificationToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { select: { id: true, name: true, email: true, passwordHash: true } } } });
  if (!record || record.type !== "ACCOUNT_SETUP" || record.usedAt || record.expiresAt <= new Date()) return null;
  return record.user;
}
