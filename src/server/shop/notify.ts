import "server-only";
import type { NotificationChannel } from "@prisma/client";
import { prisma } from "@/server/db";
import { getAllSettings } from "@/server/settings";
import { deliver, notify, renderEmail } from "@/server/notifications";
import { formatMoney } from "@/lib/format";
import { shopOrderPath } from "./links";

/**
 * Customer order updates. Each notice creates an in-app notification for the
 * account and is sent to the address/number given at checkout over every
 * enabled channel. Email ships today; SMS and WhatsApp go through the same
 * `deliver()` provider registry and are recorded as skipped until a provider
 * is installed.
 */
export type ShopNotice = "PLACED" | "PAID" | "PROCESSING" | "READY_FOR_COLLECTION" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "REFUNDED";

type Order = NonNullable<Awaited<ReturnType<typeof load>>>;

const load = (id: string) => prisma.shopOrder.findUnique({ where: { id }, include: { items: true, order: { include: { payments: { where: { status: "SUCCESS" }, orderBy: { completedAt: "desc" }, take: 1 } } } } });

function itemsText(o: Order) {
  return o.items.map((i) => `• ${i.quantity} × ${i.productName}${i.variantName ? ` (${i.variantName})` : ""} — ${formatMoney(i.total, o.currency)}`).join("\n");
}

function totalsText(o: Order) {
  const lines = [`Subtotal: ${formatMoney(o.subtotal, o.currency)}`];
  if (o.discountTotal.greaterThan(0)) lines.push(`Discount${o.discountCode ? ` (${o.discountCode})` : ""}: −${formatMoney(o.discountTotal, o.currency)}`);
  lines.push(`${o.fulfillmentMethod === "COLLECTION" ? "Collection" : "Delivery"}: ${o.deliveryFee.greaterThan(0) ? formatMoney(o.deliveryFee, o.currency) : "Free"}`);
  lines.push(`Total: ${formatMoney(o.total, o.currency)}`);
  return lines.join("\n");
}

function message(o: Order, notice: ShopNotice): { title: string; body: string; short: string } {
  const first = o.customerName.split(" ")[0];
  const n = o.number;
  const where = o.fulfillmentMethod === "COLLECTION" ? `Collection: ${o.deliveryOptionName}` : `Delivery to: ${[o.address, o.town, o.county].filter(Boolean).join(", ")}`;
  switch (notice) {
    case "PLACED":
      return { title: `Order ${n} received`, body: `Hi ${first}, thanks for your order. We're holding your items while you complete the M-Pesa payment.\n\n${itemsText(o)}\n\n${totalsText(o)}\n\n${where}\n\nYour order is confirmed only after M-Pesa confirms the payment.`, short: `Order ${n} received. Total ${formatMoney(o.total, o.currency)}. Complete the M-Pesa payment to confirm it.` };
    case "PAID": {
      const receipt = o.order.payments[0]?.receiptNumber;
      return { title: `Payment confirmed — order ${n}`, body: `Hi ${first}, M-Pesa has confirmed your payment${receipt ? ` (receipt ${receipt})` : ""}. Here is your receipt.\n\n${itemsText(o)}\n\n${totalsText(o)}\n\n${where}\n\nWe'll let you know as soon as your order ${o.fulfillmentMethod === "COLLECTION" ? "is ready for collection" : "is on its way"}.`, short: `Payment of ${formatMoney(o.total, o.currency)} confirmed for order ${n}${receipt ? ` (M-Pesa ${receipt})` : ""}.` };
    }
    case "PROCESSING":
      return { title: `Order ${n} is being prepared`, body: `Hi ${first}, we're packing your order now.`, short: `Order ${n} is being prepared.` };
    case "READY_FOR_COLLECTION":
      return { title: `Order ${n} is ready for collection`, body: `Hi ${first}, your order is ready. ${o.deliveryOptionName}.${o.fulfillmentNotes ? `\n\n${o.fulfillmentNotes}` : ""}\n\nPlease bring your order number (${n}).`, short: `Order ${n} is ready for collection — ${o.deliveryOptionName}.` };
    case "SHIPPED":
      return { title: `Order ${n} is on its way`, body: `Hi ${first}, your order has been dispatched${o.courier ? ` with ${o.courier}` : ""}.${o.trackingNumber ? `\nTracking / waybill: ${o.trackingNumber}` : ""}\n\n${where}`, short: `Order ${n} dispatched${o.courier ? ` via ${o.courier}` : ""}${o.trackingNumber ? ` (${o.trackingNumber})` : ""}.` };
    case "DELIVERED":
      return { title: o.fulfillmentMethod === "COLLECTION" ? `Order ${n} collected` : `Order ${n} delivered`, body: `Hi ${first}, your order has been ${o.fulfillmentMethod === "COLLECTION" ? "collected" : "delivered"}. Enjoy your games!`, short: `Order ${n} ${o.fulfillmentMethod === "COLLECTION" ? "collected" : "delivered"}. Thank you!` };
    case "CANCELLED":
      return { title: `Order ${n} cancelled`, body: `Hi ${first}, your order has been cancelled.${o.cancelReason ? `\nReason: ${o.cancelReason}` : ""}${o.paidAt ? "\n\nYou paid for this order, so the club will arrange your refund." : ""}`, short: `Order ${n} cancelled.` };
    case "REFUNDED":
      return { title: `Refund for order ${n}`, body: `Hi ${first}, we've refunded ${formatMoney(o.total, o.currency)} for order ${n}.${o.refundReference ? `\nRefund reference: ${o.refundReference}` : ""}`, short: `Order ${n} refunded${o.refundReference ? ` (${o.refundReference})` : ""}.` };
  }
}

/** Sends a customer update. Never throws; payment receipts go out once and only after verification. */
export async function notifyShopCustomer(shopOrderId: string, notice: ShopNotice) {
  try {
    if (notice === "PAID") {
      const { count } = await prisma.shopOrder.updateMany({ where: { id: shopOrderId, paidAt: { not: null }, receiptSentAt: null }, data: { receiptSentAt: new Date() } });
      if (!count) return;
    }
    const o = await load(shopOrderId);
    if (!o) return;
    const settings = await getAllSettings();
    const { title, body, short } = message(o, notice);
    const link = shopOrderPath(o.number);
    const n = await notify({ userId: o.userId, type: notice === "PAID" ? "PAYMENT_CONFIRMED" : "SHOP_ORDER", title, body, link });
    if (settings.notifications.emailEnabled) {
      const { text, html } = await renderEmail(title, body, link, "View order");
      await deliver("EMAIL", { to: o.customerEmail, subject: title, text, html }, n.id);
    }
    const extra: NotificationChannel[] = [];
    if (settings.shop.smsUpdates && settings.notifications.smsEnabled) extra.push("SMS");
    if (settings.shop.whatsappUpdates) extra.push("WHATSAPP");
    for (const channel of extra) await deliver(channel, { to: o.customerPhone, subject: title, text: `${short} ${settings.general.siteName}` }, n.id);
  } catch (error) {
    console.error(`[shop] notify ${notice}`, error);
  }
}
