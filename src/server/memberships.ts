import "server-only";
import { prisma, type Tx } from "@/server/db";
import { UserError } from "@/server/errors";
import { addBillingPeriod, createOrder } from "@/server/orders";
import { getSettings } from "@/server/settings";
import { notify } from "@/server/notifications";
import { formatDate } from "@/lib/format";

/** A membership is active only while its status is ACTIVE and its period covers now. */
export function activeMembershipWhere(now = new Date()) {
  return { status: "ACTIVE" as const, startsAt: { lte: now }, expiresAt: { gt: now } };
}

export async function activeMemberships(userId: string, db: Tx | typeof prisma = prisma) {
  return db.membership.findMany({
    where: { userId, ...activeMembershipWhere() },
    include: { plan: true },
    orderBy: { expiresAt: "desc" },
  });
}

export async function hasActiveMembership(userId: string) {
  return (await prisma.membership.count({ where: { userId, ...activeMembershipWhere() } })) > 0;
}

/** Creates a pending order for a plan. Price comes from the plan row at this moment. */
export async function startMembershipCheckout(userId: string, planId: string) {
  const plan = await prisma.membershipPlan.findFirst({ where: { id: planId, status: "ACTIVE" } });
  if (!plan) throw new UserError("This membership plan is not available.");
  const current = await prisma.membership.findFirst({ where: { userId, planId, ...activeMembershipWhere() } });
  const membershipSettings = await getSettings("membership");
  if (current && !membershipSettings.allowEarlyRenewal) throw new UserError("Your membership is still active. You can renew it once it expires.");
  const payments = await getSettings("payments");

  // Reuse an open order for the same plan instead of stacking duplicates.
  const open = await prisma.order.findFirst({
    where: { userId, status: "PENDING", expiresAt: { gt: new Date() }, items: { some: { type: "MEMBERSHIP", membershipPlanId: planId } } },
    include: { items: true },
  });
  if (open && open.total.equals(plan.price)) return open;

  return prisma.$transaction((tx) =>
    createOrder(tx, {
      userId,
      currency: plan.currency,
      expiresAt: new Date(Date.now() + payments.orderExpiryMinutes * 60_000),
      lines: [{ type: "MEMBERSHIP", description: `${plan.name} membership${current ? " renewal" : ""}`, unitPrice: plan.price, membershipPlanId: plan.id }],
    }),
  );
}

/**
 * Activates or extends a membership after a verified payment. Idempotent:
 * MembershipPayment is unique per order item and per payment.
 */
export async function fulfilMembership(tx: Tx, input: { userId: string; planId: string; orderItemId: string; paymentId: string; timezone: string }) {
  const existing = await tx.membershipPayment.findUnique({ where: { orderItemId: input.orderItemId } });
  if (existing) return null;
  const plan = await tx.membershipPlan.findUniqueOrThrow({ where: { id: input.planId } });
  const now = new Date();
  const current = await tx.membership.findFirst({
    where: { userId: input.userId, planId: input.planId, ...activeMembershipWhere(now) },
    orderBy: { expiresAt: "desc" },
  });

  if (current?.expiresAt) {
    const newExpiry = addBillingPeriod(current.expiresAt, plan.billingPeriod);
    await tx.membership.update({ where: { id: current.id }, data: { expiresAt: newExpiry, expiryReminderAt: null } });
    await tx.membershipRenewal.create({ data: { membershipId: current.id, paymentId: input.paymentId, previousExpiry: current.expiresAt, newExpiry } });
    await tx.membershipPayment.create({ data: { membershipId: current.id, paymentId: input.paymentId, orderItemId: input.orderItemId, periodStart: current.expiresAt, periodEnd: newExpiry } });
    return notify(
      { userId: input.userId, type: "MEMBERSHIP_ACTIVATED", title: "Membership renewed", body: `Your ${plan.name} membership now runs until ${formatDate(newExpiry, input.timezone)}.`, link: "/dashboard/membership" },
      tx,
    );
  }

  const expiresAt = addBillingPeriod(now, plan.billingPeriod);
  const membership = await tx.membership.create({ data: { userId: input.userId, planId: plan.id, status: "ACTIVE", startsAt: now, expiresAt } });
  await tx.membershipPayment.create({ data: { membershipId: membership.id, paymentId: input.paymentId, orderItemId: input.orderItemId, periodStart: now, periodEnd: expiresAt } });
  return notify(
    { userId: input.userId, type: "MEMBERSHIP_ACTIVATED", title: `Welcome to ${plan.name}`, body: `Your membership is active until ${formatDate(expiresAt, input.timezone)}.`, link: "/dashboard/membership" },
    tx,
  );
}
