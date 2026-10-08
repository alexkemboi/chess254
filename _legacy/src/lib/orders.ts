import "server-only";
import type { BillingPeriod, OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nextInvoiceNumber } from "@/lib/counters";
import { getSettings, settingText } from "@/lib/settings";

type Tx = Prisma.TransactionClient;

export const ORDER_FLOW: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["CANCELLED"],
  PAID: ["PROCESSING", "READY", "SHIPPED", "DELIVERED", "COMPLETED", "CANCELLED"],
  PROCESSING: ["READY", "SHIPPED", "DELIVERED", "COMPLETED", "CANCELLED"],
  READY: ["SHIPPED", "DELIVERED", "COMPLETED", "CANCELLED"],
  SHIPPED: ["DELIVERED", "COMPLETED"],
  DELIVERED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [],
  REFUNDED: [],
};

export const PAID_STATUSES: OrderStatus[] = ["PAID", "PROCESSING", "READY", "SHIPPED", "DELIVERED", "COMPLETED"];

export function periodEnd(start: Date, period: BillingPeriod) {
  const end = new Date(start);
  if (period === "MONTHLY") end.setMonth(end.getMonth() + 1);
  else if (period === "QUARTERLY") end.setMonth(end.getMonth() + 3);
  else if (period === "ANNUAL") end.setFullYear(end.getFullYear() + 1);
  else return null;
  return end;
}

export type FulfilmentReport = { orderId: string; attention: string[]; activated: { memberships: string[]; registrations: string[]; bookings: string[] } };

/**
 * Settles an order after a verified payment (or for a zero-total order).
 * Must run inside the same transaction that records the payment.
 */
export async function fulfilPaidOrder(tx: Tx, orderId: string, paymentId: string | null, actorId: string | null = null): Promise<FulfilmentReport> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"order:" + orderId}))`;
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: { include: { product: true, membershipPlan: true, membership: true, eventRegistration: true, booking: true } } } });
  const report: FulfilmentReport = { orderId, attention: [], activated: { memberships: [], registrations: [], bookings: [] } };
  if (PAID_STATUSES.includes(order.status) || order.status === "REFUNDED") return report; // already settled: idempotent
  const holdWasLive = order.status === "PENDING";
  const now = new Date();

  for (const item of order.items) {
    if (item.itemType === "PRODUCT" && item.variantId && item.product?.trackInventory) {
      const rows = holdWasLive
        ? await tx.$queryRaw<{ quantity: number }[]>`
            UPDATE "Inventory" SET "quantity" = "quantity" - ${item.quantity}, "reserved" = GREATEST("reserved" - ${item.quantity}, 0), "updatedAt" = NOW()
            WHERE "variantId" = ${item.variantId} RETURNING "quantity"`
        : await tx.$queryRaw<{ quantity: number }[]>`
            UPDATE "Inventory" SET "quantity" = "quantity" - ${item.quantity}, "updatedAt" = NOW()
            WHERE "variantId" = ${item.variantId} AND ("allowBackorder" = true OR "quantity" - "reserved" >= ${item.quantity}) RETURNING "quantity"`;
      if (!rows.length) report.attention.push(`${item.name}: stock was no longer available when the late payment arrived.`);
      else await tx.stockMovement.create({ data: { variantId: item.variantId, type: "SALE", change: -item.quantity, quantityAfter: rows[0].quantity, orderId, reason: `Order ${order.number}`, actorId } });
    }

    if (item.itemType === "MEMBERSHIP" && item.membership && item.membershipPlan) {
      const current = await tx.membership.findFirst({
        where: { userId: item.membership.userId, planId: item.membershipPlan.id, status: "ACTIVE", expiresAt: { gt: now }, NOT: { id: item.membership.id } },
        orderBy: { expiresAt: "desc" },
      });
      const startsAt = current?.expiresAt && current.expiresAt > now ? current.expiresAt : now;
      await tx.membership.update({ where: { id: item.membership.id }, data: { status: "ACTIVE", startsAt, expiresAt: periodEnd(startsAt, item.membershipPlan.billingPeriod) } });
      if (paymentId) await tx.membershipPayment.create({ data: { membershipId: item.membership.id, paymentId } });
      report.activated.memberships.push(item.membership.id);
    }

    if (item.itemType === "EVENT" && item.eventRegistration) {
      const reg = item.eventRegistration;
      if (!holdWasLive && item.eventId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"event:" + item.eventId}))`;
        const event = await tx.event.findUnique({ where: { id: item.eventId } });
        const taken = await tx.eventRegistration.count({ where: { eventId: item.eventId, NOT: { id: reg.id }, OR: [{ status: { in: ["CONFIRMED", "ATTENDED"] } }, { status: "PENDING", holdExpiresAt: { gt: now } }] } });
        if (event?.capacity !== null && event?.capacity !== undefined && taken >= event.capacity) report.attention.push(`${item.name}: the event filled up before the late payment arrived.`);
      }
      await tx.eventRegistration.update({ where: { id: reg.id }, data: { status: "CONFIRMED", holdExpiresAt: null, paymentId } });
      report.activated.registrations.push(reg.id);
    }

    if (item.itemType === "COACHING" && item.booking) {
      const booking = item.booking;
      if (!holdWasLive) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"coach:" + booking.coachId}))`;
        const clash = await tx.booking.count({ where: { coachId: booking.coachId, NOT: { id: booking.id }, startsAt: { lt: booking.endsAt }, endsAt: { gt: booking.startsAt }, OR: [{ status: "CONFIRMED" }, { status: "PENDING", holdExpiresAt: { gt: now } }] } });
        if (clash) report.attention.push(`${item.name}: the slot was booked by someone else before the late payment arrived.`);
      }
      await tx.booking.update({ where: { id: booking.id }, data: { status: "CONFIRMED", holdExpiresAt: null, history: { create: { status: "CONFIRMED", note: "Payment confirmed", actorId } } } });
      if (paymentId) await tx.payment.update({ where: { id: paymentId }, data: { bookingId: booking.id } }).catch(() => undefined);
      report.activated.bookings.push(booking.id);
    }
  }

  if (order.couponId) {
    const exists = await tx.couponRedemption.findUnique({ where: { orderId } });
    if (!exists) {
      await tx.couponRedemption.create({ data: { couponId: order.couponId, orderId, userId: order.userId, phone: order.customerPhone, amount: order.discountTotal } });
      await tx.coupon.update({ where: { id: order.couponId }, data: { usedCount: { increment: 1 } } });
    }
  }

  const settings = await getSettings();
  const invoice = await tx.invoice.findUnique({ where: { orderId } });
  if (!invoice) await tx.invoice.create({ data: { orderId, paymentId, number: await nextInvoiceNumber(tx, settingText(settings, "commerce.invoicePrefix", "INV")) } });

  const nothingToShip = order.items.every((i) => !i.requiresShipping);
  const finalStatus: OrderStatus = nothingToShip && !report.attention.length ? "COMPLETED" : "PAID";
  await tx.order.update({ where: { id: orderId }, data: { status: finalStatus, paidAt: now, expiresAt: null, completedAt: finalStatus === "COMPLETED" ? now : null } });
  await tx.orderStatusHistory.create({ data: { orderId, from: order.status, to: "PAID", note: paymentId ? "Payment verified" : "No payment required", actorId } });
  if (finalStatus === "COMPLETED") await tx.orderStatusHistory.create({ data: { orderId, from: "PAID", to: "COMPLETED", note: "Services activated automatically", actorId } });
  if (report.attention.length) await tx.orderStatusHistory.create({ data: { orderId, from: "PAID", to: "PAID", note: `Needs attention: ${report.attention.join(" ")}`, actorId } });
  return report;
}

/** Releases stock reservations, seats, slots and pending memberships held by an unpaid order. */
export async function releaseOrder(tx: Tx, orderId: string, to: "CANCELLED" | "FAILED", note: string, actorId: string | null = null) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"order:" + orderId}))`;
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: { include: { product: true } } } });
  if (order.status !== "PENDING") return false;
  for (const item of order.items) {
    if (item.itemType === "PRODUCT" && item.variantId && item.product?.trackInventory) {
      await tx.$executeRaw`UPDATE "Inventory" SET "reserved" = GREATEST("reserved" - ${item.quantity}, 0), "updatedAt" = NOW() WHERE "variantId" = ${item.variantId}`;
    }
  }
  const itemIds = order.items.map((i) => i.id);
  await tx.membership.updateMany({ where: { orderItemId: { in: itemIds }, status: "PENDING" }, data: { status: "CANCELLED" } });
  await tx.eventRegistration.updateMany({ where: { orderItemId: { in: itemIds }, status: "PENDING" }, data: { status: "CANCELLED", holdExpiresAt: null } });
  const bookings = await tx.booking.findMany({ where: { orderItemId: { in: itemIds }, status: "PENDING" } });
  for (const b of bookings) await tx.booking.update({ where: { id: b.id }, data: { status: "CANCELLED", holdExpiresAt: null, history: { create: { status: "CANCELLED", note, actorId } } } });
  await tx.order.update({ where: { id: orderId }, data: { status: to, cancelledAt: new Date(), expiresAt: null } });
  await tx.orderStatusHistory.create({ data: { orderId, from: "PENDING", to, note, actorId } });
  return true;
}

/** Expires unpaid orders whose payment window has passed (skips ones awaiting an in-flight STK prompt). */
export async function expireStaleOrders(limit = 50) {
  const now = new Date();
  const graceCutoff = new Date(now.getTime() - 3 * 60_000);
  const stale = await prisma.order.findMany({
    where: { status: "PENDING", expiresAt: { lt: now }, NOT: { payments: { some: { status: "PROCESSING", updatedAt: { gt: graceCutoff } } } } },
    select: { id: true, payments: { select: { status: true } } },
    take: limit,
  });
  let expired = 0;
  for (const order of stale) {
    const failed = order.payments.some((p) => p.status === "FAILED" || p.status === "CANCELLED");
    const done = await prisma.$transaction((tx) => releaseOrder(tx, order.id, failed ? "FAILED" : "CANCELLED", "Payment window expired"));
    if (done) expired++;
  }
  return expired;
}

export async function transitionOrder(orderId: string, to: OrderStatus, actorId: string, note?: string | null, trackingReference?: string | null) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (to === "CANCELLED" && order.status === "PENDING") {
      await releaseOrder(tx, orderId, "CANCELLED", note || "Cancelled by staff", actorId);
      return { from: order.status, to };
    }
    if (!ORDER_FLOW[order.status].includes(to)) throw new Error(`An order that is ${order.status.toLowerCase()} can't move to ${to.toLowerCase()}.`);
    if (to === "CANCELLED") await cancelOrderServices(tx, orderId, note || "Order cancelled", actorId);
    if (order.fulfilment === "PICKUP" && to === "SHIPPED") throw new Error("Pickup orders are marked ready, then completed when collected.");
    await tx.order.update({
      where: { id: orderId },
      data: { status: to, ...(to === "COMPLETED" ? { completedAt: new Date() } : {}), ...(to === "CANCELLED" ? { cancelledAt: new Date() } : {}), ...(trackingReference !== undefined && trackingReference !== null ? { trackingReference } : {}) },
    });
    await tx.orderStatusHistory.create({ data: { orderId, from: order.status, to, note: note || null, actorId } });
    return { from: order.status, to };
  });
}

/** Cancels memberships, seats and coaching sessions delivered by a paid order (used for cancellations and refunds). */
export async function cancelOrderServices(tx: Tx, orderId: string, note: string, actorId: string | null) {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { id: true } });
  const ids = items.map((i) => i.id);
  await tx.membership.updateMany({ where: { orderItemId: { in: ids }, status: { in: ["ACTIVE", "PENDING"] } }, data: { status: "CANCELLED" } });
  await tx.eventRegistration.updateMany({ where: { orderItemId: { in: ids }, status: { in: ["CONFIRMED", "PENDING"] } }, data: { status: "CANCELLED", holdExpiresAt: null } });
  const bookings = await tx.booking.findMany({ where: { orderItemId: { in: ids }, status: { in: ["CONFIRMED", "PENDING"] } } });
  for (const b of bookings) await tx.booking.update({ where: { id: b.id }, data: { status: "CANCELLED", holdExpiresAt: null, history: { create: { status: "CANCELLED", note, actorId } } } });
}

/** Puts sold stock back on the shelf (refunds/returns). */
export async function restockOrder(tx: Tx, orderId: string, actorId: string | null, reason: string) {
  const items = await tx.orderItem.findMany({ where: { orderId, itemType: "PRODUCT", variantId: { not: null } }, include: { product: true } });
  for (const item of items) {
    if (!item.product?.trackInventory || !item.variantId) continue;
    const sold = await tx.stockMovement.aggregate({ where: { orderId, variantId: item.variantId }, _sum: { change: true } });
    const outstanding = -(sold._sum.change ?? 0);
    if (outstanding <= 0) continue;
    const rows = await tx.$queryRaw<{ quantity: number }[]>`UPDATE "Inventory" SET "quantity" = "quantity" + ${outstanding}, "updatedAt" = NOW() WHERE "variantId" = ${item.variantId} RETURNING "quantity"`;
    if (rows.length) await tx.stockMovement.create({ data: { variantId: item.variantId, type: "RETURN", change: outstanding, quantityAfter: rows[0].quantity, orderId, reason, actorId } });
  }
}
