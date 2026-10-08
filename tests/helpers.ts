import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

export const prisma = new PrismaClient();
export const TEST_DOMAIN = "@test.chess254.invalid";
export const TEST_PREFIX = "TEST ";
export const APP_URL = process.env.TEST_APP_URL ?? "http://127.0.0.1:3100";
export const DARAJA_URL = process.env.MPESA_API_BASE_URL ?? "http://127.0.0.1:4010";
export const TEST_PASSWORD = "Test-password-123";

let counter = 0;
export async function makeUser(label: string, role: "MEMBER" | "COACH" | "ADMIN" | "SUPER_ADMIN" | "MODERATOR" = "MEMBER") {
  counter += 1;
  return prisma.user.create({
    data: {
      email: `${label}-${Date.now()}-${counter}${TEST_DOMAIN}`,
      name: `${TEST_PREFIX}${label}`,
      passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
      role,
      emailVerifiedAt: new Date(),
      memberProfile: { create: {} },
    },
  });
}

export async function completePayment(body: { checkoutRequestId?: string; result: "success" | "cancelled" | "failed"; times?: number; queryOverride?: string; paidAmount?: number; sendCallback?: boolean }) {
  const res = await fetch(`${DARAJA_URL}/__control/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`mock control failed: ${res.status}`);
  return res.json() as Promise<{ responses: { status: number; body: { ResultDesc?: string } | null }[] }>;
}

/** Removes every record created by the tests. */
export async function cleanup(since?: Date) {
  // Tests sign in many times from one IP; reset throttles so runs are repeatable.
  await prisma.rateLimit.deleteMany({ where: { OR: [{ key: { startsWith: "login:" } }, { key: { startsWith: "community:" } }, { key: { startsWith: "pay:" } }, { key: { startsWith: "book:" } }, { key: { startsWith: "event:" } }] } });
  const users = await prisma.user.findMany({ where: { email: { endsWith: TEST_DOMAIN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const testSessionTypes = await prisma.sessionType.findMany({ where: { name: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const testEvents = await prisma.event.findMany({ where: { title: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const stIds = testSessionTypes.map((s) => s.id);
  const evIds = testEvents.map((e) => e.id);
  await prisma.membershipRenewal.deleteMany({ where: { membership: { userId: { in: ids } } } });
  await prisma.membershipPayment.deleteMany({ where: { membership: { userId: { in: ids } } } });
  await prisma.invoice.deleteMany({ where: { order: { userId: { in: ids } } } });
  await prisma.paymentCallback.deleteMany({ where: { payment: { userId: { in: ids } } } });
  await prisma.payment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.order.deleteMany({ where: { userId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { userId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { OR: [{ memberId: { in: ids } }, { sessionTypeId: { in: stIds } }] } });
  await prisma.eventRegistration.deleteMany({ where: { OR: [{ userId: { in: ids } }, { eventId: { in: evIds } }] } });
  await prisma.servicePurchase.deleteMany({ where: { userId: { in: ids } } });
  await prisma.learningAssignment.deleteMany({ where: { OR: [{ memberId: { in: ids } }, { coach: { userId: { in: ids } } }] } });
  await prisma.communityReport.deleteMany({ where: { reporterId: { in: ids } } });
  await prisma.communityComment.deleteMany({ where: { authorId: { in: ids } } });
  await prisma.communityPost.deleteMany({ where: { authorId: { in: ids } } });
  await prisma.coachProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.sessionType.deleteMany({ where: { id: { in: stIds } } });
  await prisma.event.deleteMany({ where: { id: { in: evIds } } });
  await prisma.closureDate.deleteMany({ where: { reason: { startsWith: TEST_PREFIX } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  // Unmatched callbacks produced by this run only (forged / unknown-payment tests).
  if (since) await prisma.paymentCallback.deleteMany({ where: { paymentId: null, providerKey: "mpesa", receivedAt: { gte: since } } });
}
