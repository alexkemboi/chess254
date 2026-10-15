/** Shop rules shared by server and client: pricing, variant labels and order status flow. */
import { toNumber } from "@/lib/format";

type Numeric = number | string | { toString(): string } | null | undefined;

export type ShopStatus = "PENDING_PAYMENT" | "PAID" | "PROCESSING" | "READY_FOR_COLLECTION" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "REFUNDED";
export type Fulfillment = "DELIVERY" | "COLLECTION";

export const SHOP_STATUS_LABELS: Record<ShopStatus, string> = {
  PENDING_PAYMENT: "Pending payment",
  PAID: "Paid",
  PROCESSING: "Processing",
  READY_FOR_COLLECTION: "Ready for collection",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

export const SHOP_STATUSES = Object.keys(SHOP_STATUS_LABELS) as ShopStatus[];

/**
 * Staff-driven transitions. PENDING_PAYMENT → PAID is deliberately absent:
 * only a verified M-Pesa payment (or an audited manual settlement of the
 * payment itself) can mark an order paid.
 */
const TRANSITIONS: Record<ShopStatus, ShopStatus[]> = {
  PENDING_PAYMENT: ["CANCELLED"],
  PAID: ["PROCESSING", "READY_FOR_COLLECTION", "SHIPPED", "CANCELLED", "REFUNDED"],
  PROCESSING: ["READY_FOR_COLLECTION", "SHIPPED", "CANCELLED", "REFUNDED"],
  READY_FOR_COLLECTION: ["DELIVERED", "CANCELLED", "REFUNDED"],
  SHIPPED: ["DELIVERED", "REFUNDED"],
  DELIVERED: ["REFUNDED"],
  CANCELLED: ["REFUNDED"],
  REFUNDED: [],
};

export function allowedTransitions(order: { status: ShopStatus; fulfillmentMethod: Fulfillment; paidAt: Date | string | null }) {
  return TRANSITIONS[order.status].filter((to) => {
    if (to === "READY_FOR_COLLECTION") return order.fulfillmentMethod === "COLLECTION";
    if (to === "SHIPPED") return order.fulfillmentMethod === "DELIVERY";
    if (to === "REFUNDED") return Boolean(order.paidAt);
    return true;
  });
}

export function canTransition(order: Parameters<typeof allowedTransitions>[0], to: ShopStatus) {
  return allowedTransitions(order).includes(to);
}

/** Customer-facing progress steps for the order tracker. */
export function progressSteps(method: Fulfillment): ShopStatus[] {
  return method === "COLLECTION" ? ["PENDING_PAYMENT", "PAID", "PROCESSING", "READY_FOR_COLLECTION", "DELIVERED"] : ["PENDING_PAYMENT", "PAID", "PROCESSING", "SHIPPED", "DELIVERED"];
}

export function stepLabel(status: ShopStatus, method: Fulfillment) {
  if (status === "DELIVERED" && method === "COLLECTION") return "Collected";
  if (status === "SHIPPED") return "Dispatched";
  return SHOP_STATUS_LABELS[status];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Price a variant. A variant price overrides the product price; a sale price
 * applies only when it is lower than the regular price it belongs to.
 */
export function priceOf(product: { price: Numeric; salePrice: Numeric }, variant?: { price: Numeric; salePrice: Numeric } | null) {
  const hasOwnPrice = variant?.price !== null && variant?.price !== undefined;
  const regular = round2(toNumber(hasOwnPrice ? variant!.price : product.price));
  const saleRaw = hasOwnPrice ? variant!.salePrice : (variant?.salePrice ?? product.salePrice);
  const sale = saleRaw === null || saleRaw === undefined ? null : round2(toNumber(saleRaw));
  const onSale = sale !== null && sale < regular;
  return { regular, effective: onSale ? sale! : regular, onSale };
}

export function discountPercent(regular: number, effective: number) {
  return regular > 0 && effective < regular ? Math.round(((regular - effective) / regular) * 100) : 0;
}

export type VariantOptions = Record<string, string>;

export function parseOptions(value: unknown): VariantOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => typeof v === "string" && v).map(([k, v]) => [k, String(v)]));
}

export function optionsLabel(options: VariantOptions) {
  return Object.values(options).filter(Boolean).join(" / ");
}

export function available(variant: { stockOnHand: number; stockReserved: number }) {
  return Math.max(0, variant.stockOnHand - variant.stockReserved);
}
