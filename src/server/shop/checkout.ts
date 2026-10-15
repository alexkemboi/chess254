import "server-only";
import { Prisma, type DeliveryOption, type DiscountCode, type FulfillmentMethod } from "@prisma/client";
import { prisma } from "@/server/db";
import { UserError } from "@/server/errors";
import { getSettings } from "@/server/settings";
import { createOrder, type OrderLine } from "@/server/orders";
import { findOrCreateContactUser } from "@/server/account-setup";
import { formatMoney } from "@/lib/format";
import { cartView, type CartLine } from "./cart";
import { reserveStock } from "./inventory";
import { releaseShopOrder } from "./lifecycle";
import { notifyShopCustomer } from "./notify";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function activeDeliveryOptions() {
  return prisma.deliveryOption.findMany({ where: { active: true }, orderBy: [{ position: "asc" }, { fee: "asc" }] });
}

export function servesCounty(option: Pick<DeliveryOption, "method" | "counties">, county: string | null | undefined) {
  if (option.method === "COLLECTION" || option.counties.length === 0) return true;
  return Boolean(county) && option.counties.some((c) => c.toLowerCase() === county!.toLowerCase());
}

export function deliveryFeeFor(option: Pick<DeliveryOption, "fee" | "freeAbove">, merchandiseTotal: number) {
  if (option.freeAbove !== null && merchandiseTotal >= option.freeAbove.toNumber()) return 0;
  return round2(option.fee.toNumber());
}

/** Validates a code for this basket; returns the discount amount (never more than the merchandise subtotal). */
export async function evaluateDiscount(rawCode: string, subtotal: number, email: string | null): Promise<{ discount: DiscountCode; amount: number }> {
  const code = rawCode.trim().toUpperCase();
  const discount = await prisma.discountCode.findUnique({ where: { code } });
  const now = new Date();
  const fail = (message: string): never => {
    throw new UserError(message, { discountCode: message });
  };
  if (!discount || !discount.active) return fail("That discount code isn't valid.");
  if (discount.startsAt && discount.startsAt > now) return fail("That discount code isn't active yet.");
  if (discount.endsAt && discount.endsAt < now) return fail("That discount code has expired.");
  if (discount.maxUses !== null && discount.usesCount >= discount.maxUses) return fail("That discount code has been fully used.");
  if (discount.minSubtotal && subtotal < discount.minSubtotal.toNumber()) return fail(`Spend at least ${formatMoney(discount.minSubtotal, "KES")} to use this code.`);
  if (discount.perCustomerLimit && email) {
    const used = await prisma.shopOrder.count({ where: { discountCodeId: discount.id, customerEmail: email.toLowerCase(), OR: [{ paidAt: { not: null } }, { status: "PENDING_PAYMENT" }] } });
    if (used >= discount.perCustomerLimit) return fail("You've already used this discount code.");
  }
  const value = discount.value.toNumber();
  const amount = round2(Math.min(subtotal, discount.type === "PERCENT" ? (subtotal * value) / 100 : value));
  return { discount, amount };
}

export type Quote = {
  lines: CartLine[];
  hasIssues: boolean;
  currency: string;
  subtotal: number;
  discountCode: string | null;
  discountAmount: number;
  discountError: string | null;
  deliveryOption: DeliveryOption | null;
  deliveryFee: number;
  deliveryError: string | null;
  total: number;
};

/** Prices the checkout entirely from the database; the browser's numbers are never used. */
export async function quoteCheckout(input: { cartId: string | null; deliveryOptionId?: string | null; county?: string | null; discountCode?: string | null; email?: string | null }): Promise<Quote> {
  const cart = await cartView(input.cartId);
  const subtotal = cart.subtotal;
  let discountAmount = 0;
  let discountCode: string | null = null;
  let discountError: string | null = null;
  if (input.discountCode?.trim()) {
    try {
      const d = await evaluateDiscount(input.discountCode, subtotal, input.email ?? null);
      discountAmount = d.amount;
      discountCode = d.discount.code;
    } catch (e) {
      discountError = e instanceof UserError ? e.message : "That discount code isn't valid.";
    }
  }
  let deliveryOption: DeliveryOption | null = null;
  let deliveryError: string | null = null;
  let deliveryFee = 0;
  if (input.deliveryOptionId) {
    deliveryOption = await prisma.deliveryOption.findFirst({ where: { id: input.deliveryOptionId, active: true } });
    if (!deliveryOption) deliveryError = "Choose a delivery or collection option.";
    else if (!servesCounty(deliveryOption, input.county)) deliveryError = input.county ? `${deliveryOption.name} doesn't deliver to ${input.county}.` : "Choose your county.";
    else deliveryFee = deliveryFeeFor(deliveryOption, subtotal - discountAmount);
  }
  return {
    lines: cart.lines,
    hasIssues: cart.hasIssues,
    currency: cart.currency,
    subtotal,
    discountCode,
    discountAmount,
    discountError,
    deliveryOption,
    deliveryFee,
    deliveryError,
    total: round2(Math.max(0, subtotal - discountAmount) + deliveryFee),
  };
}

export type PlaceOrderInput = {
  cartId: string;
  idempotencyKey: string;
  viewerId: string | null;
  name: string;
  email: string;
  phone: string;
  method: FulfillmentMethod;
  deliveryOptionId: string;
  county: string | null;
  town: string | null;
  address: string | null;
  instructions: string | null;
  discountCode: string | null;
};

/**
 * Turns the cart into an order: re-prices everything server-side, reserves
 * stock and creates the payment order. Re-submitting the same checkout
 * (double click, retry after a network error) returns the same order.
 */
export async function placeShopOrder(input: PlaceOrderInput) {
  const shop = await getSettings("shop");
  if (!shop.enabled) throw new UserError("The shop is closed right now. Please check back soon.");
  const existing = await prisma.shopOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;

  const email = input.email.trim().toLowerCase();
  const quote = await quoteCheckout({ cartId: input.cartId, deliveryOptionId: input.deliveryOptionId, county: input.county, discountCode: input.discountCode, email });
  if (!quote.lines.length) throw new UserError("Your cart is empty.");
  if (quote.hasIssues) throw new UserError("Some items in your cart are no longer available in that quantity. Please review your cart.");
  const option = quote.deliveryOption;
  if (!option) throw new UserError(quote.deliveryError ?? "Choose a delivery or collection option.", { deliveryOptionId: "Required" });
  if (option.method !== input.method) throw new UserError("Choose a delivery or collection option.", { deliveryOptionId: "Required" });
  const errors: Record<string, string> = {};
  if (input.method === "DELIVERY") {
    if (!input.county) errors.county = "Choose your county";
    if (!input.town) errors.town = "Enter your town or area";
    if (!input.address) errors.address = "Enter the delivery address";
  }
  if (quote.deliveryError) errors.deliveryOptionId = quote.deliveryError;
  if (quote.discountError) errors.discountCode = quote.discountError;
  if (Object.keys(errors).length) throw new UserError(Object.values(errors)[0], errors);

  const userId = await findOrCreateContactUser(input.viewerId, { name: input.name, email, phone: input.phone }, "email");
  const discount = quote.discountCode ? await prisma.discountCode.findUnique({ where: { code: quote.discountCode } }) : null;

  try {
    const shopOrder = await prisma.$transaction(
      async (tx) => {
        // An earlier unpaid order from this cart is replaced, so its stock isn't held twice.
        const stale = await tx.shopOrder.findMany({ where: { cartId: input.cartId, status: "PENDING_PAYMENT" }, include: { order: { include: { payments: { where: { status: "PROCESSING" }, select: { id: true } } } } } });
        for (const s of stale) {
          if (s.order.payments.length) throw new UserError(`An M-Pesa payment for your earlier order ${s.number} is still in progress. Please wait for it to finish.`);
          const { count } = await tx.order.updateMany({ where: { id: s.orderId, status: "PENDING" }, data: { status: "CANCELLED" } });
          if (count) await releaseShopOrder(tx, s.orderId, "CANCELLED", "Replaced by a newer checkout");
        }
        if (discount) {
          const used = await tx.$executeRaw`UPDATE "DiscountCode" SET "usesCount" = "usesCount" + 1 WHERE "id" = ${discount.id} AND "active" = true AND ("maxUses" IS NULL OR "usesCount" < "maxUses")`;
          if (!used) throw new UserError("That discount code has just been fully used.", { discountCode: "No longer available" });
        }
        const lines: OrderLine[] = quote.lines.map((l) => ({ type: "MERCHANDISE", description: `${l.name}${l.variantName ? ` — ${l.variantName}` : ""}`, unitPrice: l.unitPrice, quantity: l.quantity }));
        if (quote.deliveryFee > 0) lines.push({ type: "MERCHANDISE", description: `Delivery: ${option.name}`, unitPrice: quote.deliveryFee });
        if (quote.discountAmount > 0) lines.push({ type: "MERCHANDISE", description: `Discount ${quote.discountCode}`, unitPrice: -quote.discountAmount });
        const order = await createOrder(tx, { userId, currency: quote.currency, lines, expiresAt: new Date(Date.now() + shop.reservationMinutes * 60_000) });
        const created = await tx.shopOrder.create({
          data: {
            number: order.number,
            orderId: order.id,
            userId,
            cartId: input.cartId,
            idempotencyKey: input.idempotencyKey,
            currency: quote.currency,
            subtotal: quote.subtotal,
            discountTotal: quote.discountAmount,
            deliveryFee: quote.deliveryFee,
            tax: order.tax,
            total: order.total,
            discountCodeId: discount?.id ?? null,
            discountCode: quote.discountCode,
            customerName: input.name,
            customerEmail: email,
            customerPhone: input.phone,
            fulfillmentMethod: option.method,
            deliveryOptionId: option.id,
            deliveryOptionName: option.name,
            county: input.method === "DELIVERY" ? input.county : null,
            town: input.method === "DELIVERY" ? input.town : null,
            address: input.method === "DELIVERY" ? input.address : null,
            deliveryInstructions: input.instructions,
            items: {
              create: quote.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, productName: l.name, variantName: l.variantName, sku: l.sku, imageUrl: l.image, unitPrice: l.unitPrice, quantity: l.quantity, total: l.lineTotal })),
            },
          },
        });
        await reserveStock(tx, quote.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, label: [l.name, l.variantName].filter(Boolean).join(" — ") })), created.id);
        await tx.shopOrderEvent.create({ data: { shopOrderId: created.id, kind: "STATUS", toStatus: "PENDING_PAYMENT", note: `Order placed — stock held for ${shop.reservationMinutes} minutes.`, actorId: input.viewerId } });
        return created;
      },
      { timeout: 20_000 },
    );
    await notifyShopCustomer(shopOrder.id, "PLACED");
    return shopOrder;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const again = await prisma.shopOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (again) return again;
    }
    throw error;
  }
}
