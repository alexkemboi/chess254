import "server-only";
import type { ShopOrderStatus } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import { UserError } from "@/server/errors";
import { audit } from "@/server/audit";
import { alertAdmins } from "@/server/notifications";
import { canTransition, SHOP_STATUS_LABELS, type ShopStatus } from "@/lib/shop";
import { commitStock, releaseStock, returnStock, checkLowStock } from "./inventory";
import { notifyShopCustomer, type ShopNotice } from "./notify";
import { shopOrderPath } from "./links";

const linesOf = (items: { variantId: string; quantity: number; productName: string; variantName: string | null }[]) =>
  items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, label: [i.productName, i.variantName].filter(Boolean).join(" — ") }));

// ─── Payment hooks (called inside the payment service's transaction) ──────

/**
 * Fulfilment for a verified payment: marks the shop order paid and converts the
 * stock reservation into a sale. Idempotent — a second call does nothing.
 */
export async function fulfilShopOrder(tx: Tx, orderId: string, paymentId: string, refunds: string[]) {
  const so = await tx.shopOrder.findUnique({ where: { orderId }, include: { items: true } });
  if (!so || so.paidAt) return null;
  const reserved = !so.stockReleasedAt && !so.stockCommittedAt;
  const shortfalls = await commitStock(tx, linesOf(so.items), so.id, reserved);
  const payment = await tx.payment.findUnique({ where: { id: paymentId }, select: { receiptNumber: true, amount: true } });
  const now = new Date();
  await tx.shopOrder.update({
    where: { id: so.id },
    data: { status: "PAID", paidAt: now, stockCommittedAt: now, ...(so.status === "CANCELLED" ? { cancelledAt: null, cancelReason: null } : {}) },
  });
  await tx.shopOrderEvent.create({ data: { shopOrderId: so.id, kind: "PAYMENT", fromStatus: so.status, toStatus: "PAID", note: `M-Pesa payment verified${payment?.receiptNumber ? ` (receipt ${payment.receiptNumber})` : ""}.` } });
  if (shortfalls.length) {
    const what = shortfalls.map((s) => `${s.quantity} × ${s.label}`).join(", ");
    await tx.shopOrderEvent.create({ data: { shopOrderId: so.id, kind: "STOCK", note: `Paid after the stock hold lapsed and not enough stock remained for: ${what}. Restock, or refund the customer.` } });
    refunds.push(`Shop order ${so.number}: paid, but stock ran out for ${what}. Restock or refund.`);
  }
  return so.id;
}

/** Releases an unpaid order's stock and discount when its payment window lapses or it is cancelled. */
export async function releaseShopOrder(tx: Tx, orderId: string, reason: "EXPIRED" | "CANCELLED", note?: string, actorId?: string | null) {
  const so = await tx.shopOrder.findUnique({ where: { orderId }, include: { items: true } });
  if (!so) return null;
  const { count } = await tx.shopOrder.updateMany({
    where: { id: so.id, status: "PENDING_PAYMENT", paidAt: null, stockReleasedAt: null },
    data: { status: "CANCELLED", cancelledAt: new Date(), stockReleasedAt: new Date(), cancelReason: note ?? (reason === "EXPIRED" ? "Payment was not received in time" : "Cancelled before payment") },
  });
  if (!count) return null;
  await releaseStock(tx, linesOf(so.items), so.id, reason === "EXPIRED" ? "Payment window lapsed" : "Order cancelled");
  if (so.discountCodeId) await tx.$executeRaw`UPDATE "DiscountCode" SET "usesCount" = GREATEST("usesCount" - 1, 0) WHERE "id" = ${so.discountCodeId}`;
  await tx.shopOrderEvent.create({ data: { shopOrderId: so.id, kind: "STATUS", fromStatus: "PENDING_PAYMENT", toStatus: "CANCELLED", note: note ?? (reason === "EXPIRED" ? "Payment window lapsed — stock released." : "Cancelled before payment — stock released."), actorId: actorId ?? null } });
  return so.id;
}

/** Post-commit work after a payment succeeded: receipt to the customer and low-stock alerts. */
export async function afterShopPayment(orderId: string) {
  const so = await prisma.shopOrder.findUnique({ where: { orderId }, include: { items: { select: { variantId: true } } } });
  if (!so?.paidAt) return;
  // The basket is emptied only once money is confirmed, so a failed payment never loses it.
  if (so.cartId) await prisma.cartItem.deleteMany({ where: { cartId: so.cartId, variantId: { in: so.items.map((i) => i.variantId) } } });
  await notifyShopCustomer(so.id, "PAID");
  await checkLowStock(so.items.map((i) => i.variantId));
}

// ─── Customer & staff actions ─────────────────────────────────────────────

async function cancelUnpaid(shopOrderId: string, reason: string, actorId: string | null) {
  const so = await prisma.shopOrder.findUnique({ where: { id: shopOrderId }, include: { order: { include: { payments: true } } } });
  if (!so) throw new UserError("Order not found.");
  if (so.status !== "PENDING_PAYMENT") throw new UserError("Only unpaid orders can be cancelled this way.");
  if (so.order.payments.some((p) => p.status === "PROCESSING")) throw new UserError("An M-Pesa payment for this order is in progress. Wait for it to finish first.");
  const released = await prisma.$transaction(async (tx) => {
    const { count } = await tx.order.updateMany({ where: { id: so.orderId, status: "PENDING" }, data: { status: "CANCELLED" } });
    if (!count) throw new UserError("This order can no longer be cancelled.");
    return releaseShopOrder(tx, so.orderId, "CANCELLED", reason, actorId);
  });
  if (!released) throw new UserError("This order can no longer be cancelled.");
}

export async function customerCancelShopOrder(number: string) {
  const so = await prisma.shopOrder.findUnique({ where: { number } });
  if (!so) throw new UserError("Order not found.");
  await cancelUnpaid(so.id, "Cancelled by the customer before payment", null);
}

const STAMP: Partial<Record<ShopOrderStatus, "processingAt" | "readyAt" | "shippedAt" | "deliveredAt" | "cancelledAt" | "refundedAt">> = {
  PROCESSING: "processingAt",
  READY_FOR_COLLECTION: "readyAt",
  SHIPPED: "shippedAt",
  DELIVERED: "deliveredAt",
  CANCELLED: "cancelledAt",
  REFUNDED: "refundedAt",
};

export type TransitionInput = {
  to: ShopStatus;
  note?: string | null;
  courier?: string | null;
  trackingNumber?: string | null;
  collectedBy?: string | null;
  restock?: boolean;
  refundReference?: string | null;
  notifyCustomer?: boolean;
};

/**
 * Staff status change. The allowed-transition table is enforced here, and the
 * conditional update on the current status means two staff members acting at
 * once can't both apply a change.
 */
export async function transitionShopOrder(shopOrderId: string, input: TransitionInput, actorId: string) {
  const so = await prisma.shopOrder.findUnique({ where: { id: shopOrderId }, include: { items: true, movements: { where: { type: "RETURN" }, select: { id: true } } } });
  if (!so) throw new UserError("Order not found.");
  if (!canTransition(so, input.to)) throw new UserError(`An order that is ${SHOP_STATUS_LABELS[so.status].toLowerCase()} can't be marked ${SHOP_STATUS_LABELS[input.to].toLowerCase()}.`);

  if (so.status === "PENDING_PAYMENT" && input.to === "CANCELLED") {
    await cancelUnpaid(so.id, input.note || "Cancelled by staff before payment", actorId);
    await audit({ actorId, action: "shop_order.cancel", entity: "ShopOrder", entityId: so.id, previous: { status: so.status }, next: { status: "CANCELLED", note: input.note } });
    if (input.notifyCustomer !== false) await notifyShopCustomer(so.id, "CANCELLED");
    return;
  }
  if (input.to === "REFUNDED" && !input.refundReference?.trim()) throw new UserError("Enter the refund reference (e.g. the M-Pesa reversal or B2C code).", { refundReference: "Required" });
  if (input.to === "CANCELLED" && !input.note?.trim()) throw new UserError("Give a reason for cancelling a paid order.", { note: "Required" });

  const restock = Boolean(input.restock) && Boolean(so.stockCommittedAt) && so.movements.length === 0 && (input.to === "CANCELLED" || input.to === "REFUNDED");
  const stamp = STAMP[input.to];
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.shopOrder.updateMany({
      where: { id: so.id, status: so.status },
      data: {
        status: input.to,
        ...(stamp ? { [stamp]: new Date() } : {}),
        ...(input.courier !== undefined && input.courier !== null ? { courier: input.courier || null } : {}),
        ...(input.trackingNumber !== undefined && input.trackingNumber !== null ? { trackingNumber: input.trackingNumber || null } : {}),
        ...(input.collectedBy ? { collectedBy: input.collectedBy } : {}),
        ...(input.to === "CANCELLED" ? { cancelReason: input.note } : {}),
        ...(input.to === "REFUNDED" ? { refundReference: input.refundReference!.trim() } : {}),
      },
    });
    if (!count) throw new UserError("Someone else just updated this order. Reload and try again.");
    if (restock) await returnStock(tx, linesOf(so.items), so.id, actorId, input.to === "REFUNDED" ? "Refunded — returned to stock" : "Cancelled — returned to stock");
    if (input.to === "REFUNDED") {
      await tx.order.update({ where: { id: so.orderId }, data: { status: "REFUNDED" } });
      const payment = await tx.payment.findFirst({ where: { orderId: so.orderId, status: "SUCCESS" }, orderBy: { completedAt: "desc" } });
      if (payment) {
        await tx.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
        await tx.paymentTransaction.create({ data: { paymentId: payment.id, kind: "MANUAL", status: "REFUNDED", reference: input.refundReference, message: `Refund recorded for shop order ${so.number}`, actorId } });
      }
    }
    const details = [input.note, input.courier && `Courier: ${input.courier}`, input.trackingNumber && `Tracking: ${input.trackingNumber}`, input.collectedBy && `Collected by: ${input.collectedBy}`, input.refundReference && `Refund ref: ${input.refundReference}`, restock && "Items returned to stock"].filter(Boolean).join(" · ");
    await tx.shopOrderEvent.create({ data: { shopOrderId: so.id, kind: "STATUS", fromStatus: so.status, toStatus: input.to, note: details || null, actorId } });
  });
  await audit({ actorId, action: `shop_order.${input.to.toLowerCase()}`, entity: "ShopOrder", entityId: so.id, previous: { status: so.status }, next: { status: input.to, note: input.note, courier: input.courier, trackingNumber: input.trackingNumber, refundReference: input.refundReference, restock } });
  if (input.to === "CANCELLED" && so.paidAt) await alertAdmins("Refund due", `Paid shop order ${so.number} was cancelled. Record the refund once it is sent.`, `/admin/shop/orders/${so.id}`).catch(() => {});
  if (input.notifyCustomer !== false) await notifyShopCustomer(so.id, input.to as ShopNotice);
}

export async function updateFulfilment(shopOrderId: string, data: { courier: string | null; trackingNumber: string | null; collectedBy: string | null; fulfillmentNotes: string | null }, actorId: string) {
  const so = await prisma.shopOrder.findUnique({ where: { id: shopOrderId } });
  if (!so) throw new UserError("Order not found.");
  if (so.status === "PENDING_PAYMENT") throw new UserError("Fulfilment details can be added once the order is paid.");
  await prisma.$transaction([
    prisma.shopOrder.update({ where: { id: so.id }, data }),
    prisma.shopOrderEvent.create({ data: { shopOrderId: so.id, kind: "FULFILMENT", note: [data.courier && `Courier: ${data.courier}`, data.trackingNumber && `Tracking: ${data.trackingNumber}`, data.collectedBy && `Collected by: ${data.collectedBy}`, data.fulfillmentNotes && `Notes: ${data.fulfillmentNotes}`].filter(Boolean).join(" · ") || "Fulfilment details cleared", actorId } }),
  ]);
  await audit({ actorId, action: "shop_order.fulfilment", entity: "ShopOrder", entityId: so.id, previous: { courier: so.courier, trackingNumber: so.trackingNumber, collectedBy: so.collectedBy, fulfillmentNotes: so.fulfillmentNotes }, next: data });
}

export async function addShopOrderNote(shopOrderId: string, note: string, actorId: string) {
  await prisma.shopOrderEvent.create({ data: { shopOrderId, kind: "NOTE", note, actorId } });
}

export { shopOrderPath };
