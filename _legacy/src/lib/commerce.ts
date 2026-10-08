import "server-only";
import type { Coupon, DeliveryZone, FulfilmentMethod, ItemType, Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { orderAccessToken, randomToken, sha256 } from "@/lib/crypto";
import { nextOrderNumber } from "@/lib/counters";
import { getSettings, settingBool, settingNumber, settingText } from "@/lib/settings";
import { getActivePromotions, hasActiveMembership, scopeMatches, type PriceTarget } from "@/lib/pricing";
import { getIntegrationConfig } from "@/lib/integrations";
import { eventSeatsTaken, type CartView } from "@/lib/cart";
import { toNumber } from "@/lib/format";

export class CheckoutError extends Error {}

export type OrderLine = {
  itemType: ItemType;
  name: string;
  detail: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPrice: number;
  originalPrice: number;
  lineTotal: number;
  requiresShipping: boolean;
  productId?: string;
  variantId?: string;
  categoryId?: string | null;
  sku?: string;
  trackInventory?: boolean;
  membershipPlanId?: string;
  eventId?: string;
  sessionTypeId?: string;
  coachId?: string;
  startsAt?: Date;
  endsAt?: Date;
  bookingNotes?: string;
};

export function linesFromCart(cart: CartView): OrderLine[] {
  return cart.lines.filter((l) => !l.issue).map((l) => ({
    itemType: l.itemType, name: l.name, detail: l.detail, imageUrl: l.imageUrl, quantity: l.quantity,
    unitPrice: l.unit.unitPrice, originalPrice: l.unit.originalPrice, lineTotal: l.lineTotal, requiresShipping: l.requiresShipping,
    productId: l.refs.productId, variantId: l.refs.variantId, categoryId: l.refs.categoryId, sku: l.refs.sku, trackInventory: l.refs.trackInventory,
    membershipPlanId: l.refs.membershipPlanId, eventId: l.refs.eventId,
  }));
}

function lineTarget(line: OrderLine): PriceTarget {
  if (line.itemType === "PRODUCT") return { kind: "PRODUCT", productId: line.productId!, categoryId: line.categoryId ?? null };
  if (line.itemType === "MEMBERSHIP") return { kind: "MEMBERSHIP", planId: line.membershipPlanId! };
  if (line.itemType === "EVENT") return { kind: "EVENT", eventId: line.eventId! };
  return { kind: "COACHING", sessionTypeId: line.sessionTypeId! };
}

// ─── Coupons ────────────────────────────────────────────────────────────────

export type CouponResult = { ok: true; coupon: Coupon; discount: number; freeDelivery: boolean; allocations: number[] } | { ok: false; reason: string };

export async function evaluateCoupon(code: string, ctx: { lines: OrderLine[]; userId: string | null; phone: string | null }): Promise<CouponResult> {
  const coupon = await prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
  const now = new Date();
  if (!coupon || !coupon.active) return { ok: false, reason: "This code isn't valid." };
  if (coupon.startsAt && coupon.startsAt > now) return { ok: false, reason: "This code isn't active yet." };
  if (coupon.endsAt && coupon.endsAt < now) return { ok: false, reason: "This code has expired." };
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) return { ok: false, reason: "This code has reached its usage limit." };
  const subtotal = ctx.lines.reduce((s, l) => s + l.lineTotal, 0);
  if (coupon.minOrderAmount !== null && subtotal < toNumber(coupon.minOrderAmount)) return { ok: false, reason: `Spend at least ${toNumber(coupon.minOrderAmount).toLocaleString("en-KE")} to use this code.` };
  if (coupon.membersOnly && !(await hasActiveMembership(ctx.userId))) return { ok: false, reason: "This code is for active members. Sign in with your member account." };
  const who: Prisma.CouponRedemptionWhereInput | null = ctx.userId ? { userId: ctx.userId } : ctx.phone ? { phone: ctx.phone } : null;
  if (coupon.perUserLimit !== null) {
    if (!who) return { ok: false, reason: "Add your phone number to use this code." };
    const used = await prisma.couponRedemption.count({ where: { couponId: coupon.id, ...who } });
    if (used >= coupon.perUserLimit) return { ok: false, reason: "You've already used this code." };
  }
  if (coupon.firstOrderOnly) {
    const ownerFilter: Prisma.OrderWhereInput | null = ctx.userId ? { userId: ctx.userId } : ctx.phone ? { customerPhone: ctx.phone } : null;
    if (!ownerFilter) return { ok: false, reason: "Add your phone number to use this code." };
    const previous = await prisma.order.count({ where: { ...ownerFilter, paidAt: { not: null } } });
    if (previous > 0) return { ok: false, reason: "This code is for first orders only." };
  }
  const eligible = ctx.lines.map((l) => (scopeMatches(coupon.scope, coupon.categoryIds, coupon.productIds, lineTarget(l)) ? l.lineTotal : 0));
  const eligibleTotal = eligible.reduce((a, b) => a + b, 0);
  if (coupon.type === "FREE_DELIVERY") {
    if (!ctx.lines.some((l) => l.requiresShipping)) return { ok: false, reason: "This code only applies to delivered orders." };
    return { ok: true, coupon, discount: 0, freeDelivery: true, allocations: ctx.lines.map(() => 0) };
  }
  if (eligibleTotal <= 0) return { ok: false, reason: "This code doesn't apply to the items in your order." };
  let discount = coupon.type === "PERCENTAGE" ? Math.round((eligibleTotal * Math.min(toNumber(coupon.value), 100)) / 100) : Math.min(Math.round(toNumber(coupon.value)), eligibleTotal);
  if (coupon.maxDiscount !== null) discount = Math.min(discount, Math.round(toNumber(coupon.maxDiscount)));
  return { ok: true, coupon, discount, freeDelivery: false, allocations: allocate(discount, eligible) };
}

/** Spreads an order-level discount across lines proportionally, in whole units. */
function allocate(total: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const parts = weights.map((w) => Math.floor((total * w) / sum));
  let remainder = total - parts.reduce((a, b) => a + b, 0);
  for (let i = 0; remainder > 0 && i < parts.length; i++) if (weights[i] > 0) { parts[i]++; remainder--; }
  return parts;
}

// ─── Delivery & fees ────────────────────────────────────────────────────────

export async function checkoutOptions() {
  const settings = await getSettings();
  const zones = await prisma.deliveryZone.findMany({ where: { active: true }, orderBy: [{ position: "asc" }, { name: "asc" }] });
  return {
    pickupEnabled: settingBool(settings, "commerce.pickupEnabled"),
    pickupLabel: settingText(settings, "commerce.pickupLabel") || `Pick up at ${settingText(settings, "club.name", "the clubhouse")}`,
    pickupInstructions: settingText(settings, "commerce.pickupInstructions"),
    pickupAddress: settingText(settings, "club.address"),
    deliveryEnabled: settingBool(settings, "commerce.deliveryEnabled") && zones.length > 0,
    guestCheckout: settingBool(settings, "commerce.guestCheckout"),
    holdMinutes: settingNumber(settings, "commerce.orderHoldMinutes"),
    zones,
  };
}

export function zoneFee(zone: DeliveryZone, merchandiseTotal: number) {
  if (zone.freeAbove !== null && merchandiseTotal >= toNumber(zone.freeAbove)) return 0;
  return Math.round(toNumber(zone.fee));
}

export async function paymentFee(amount: number) {
  if (amount <= 0) return 0;
  const cfg = await getIntegrationConfig("mpesa");
  const fixed = Number(cfg.feeFixed) || 0;
  const percent = Number(cfg.feePercent) || 0;
  return Math.ceil(fixed + (amount * percent) / 100);
}

// ─── Quote ──────────────────────────────────────────────────────────────────

export type QuoteInput = {
  lines: OrderLine[];
  fulfilment: FulfilmentMethod;
  deliveryZoneId?: string | null;
  county?: string | null;
  couponCode?: string | null;
  userId: string | null;
  phone: string | null;
};

export type Quote = {
  lines: (OrderLine & { discount: number })[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  paymentFee: number;
  total: number;
  coupon: { id: string; code: string } | null;
  couponError: string | null;
  freeDelivery: boolean;
  zone: DeliveryZone | null;
};

export async function quote(input: QuoteInput): Promise<Quote> {
  const subtotal = input.lines.reduce((s, l) => s + l.lineTotal, 0);
  let discount = 0;
  let allocations = input.lines.map(() => 0);
  let coupon: Quote["coupon"] = null;
  let couponError: string | null = null;
  let freeDelivery = false;
  if (input.couponCode) {
    const result = await evaluateCoupon(input.couponCode, { lines: input.lines, userId: input.userId, phone: input.phone });
    if (result.ok) { discount = result.discount; allocations = result.allocations; freeDelivery = result.freeDelivery; coupon = { id: result.coupon.id, code: result.coupon.code }; }
    else couponError = result.reason;
  }
  const promotions = await getActivePromotions();
  if (promotions.some((p) => p.type === "FREE_DELIVERY" && (p.scope === "ALL" || p.scope === "PRODUCTS"))) freeDelivery = true;
  let zone: DeliveryZone | null = null;
  let deliveryFee = 0;
  if (input.fulfilment === "DELIVERY" && input.deliveryZoneId) {
    zone = await prisma.deliveryZone.findFirst({ where: { id: input.deliveryZoneId, active: true } });
    if (zone && !freeDelivery) {
      const merchandise = input.lines.filter((l) => l.requiresShipping).reduce((s, l, i) => s + l.lineTotal - (allocations[i] ?? 0), 0);
      deliveryFee = zoneFee(zone, merchandise);
    }
  }
  const beforeFees = subtotal - discount + deliveryFee;
  const fee = await paymentFee(beforeFees);
  return {
    lines: input.lines.map((l, i) => ({ ...l, discount: allocations[i] ?? 0 })),
    subtotal, discount, deliveryFee, paymentFee: fee, total: beforeFees + fee, coupon, couponError, freeDelivery, zone,
  };
}

// ─── Placing orders ─────────────────────────────────────────────────────────

export type PlaceOrderInput = {
  user: User | null;
  lines: OrderLine[];
  idempotencyKey: string;
  customer: { name: string; email: string; phone: string };
  fulfilment: FulfilmentMethod;
  delivery?: { zoneId: string; county: string; town: string; address: string; instructions?: string | null } | null;
  notes?: string | null;
  couponCode?: string | null;
  clearCartId?: string | null;
};

export async function placeOrder(input: PlaceOrderInput) {
  const options = await checkoutOptions();
  const settings = await getSettings();
  if (!input.lines.length) throw new CheckoutError("Your order is empty.");
  const needsAccount = input.lines.some((l) => l.itemType !== "PRODUCT");
  if (!input.user && (needsAccount || !options.guestCheckout)) throw new CheckoutError("Please sign in to complete this order.");

  const existing = await prisma.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    if (existing.userId !== (input.user?.id ?? null)) throw new CheckoutError("This checkout session is no longer valid. Please refresh and try again.");
    return { order: existing, accessToken: orderAccessToken(existing.id), duplicate: true };
  }

  const shipping = input.lines.some((l) => l.requiresShipping);
  let fulfilment: FulfilmentMethod = "NONE";
  if (shipping) {
    if (input.fulfilment === "PICKUP" && options.pickupEnabled) fulfilment = "PICKUP";
    else if (input.fulfilment === "DELIVERY" && options.deliveryEnabled) fulfilment = "DELIVERY";
    else throw new CheckoutError("Choose pickup or delivery for your order.");
  }
  let zone: DeliveryZone | null = null;
  if (fulfilment === "DELIVERY") {
    if (!input.delivery) throw new CheckoutError("Add a delivery address.");
    zone = options.zones.find((z) => z.id === input.delivery!.zoneId) ?? null;
    if (!zone) throw new CheckoutError("Choose a delivery zone.");
    if (zone.counties.length && !zone.counties.some((c) => c.toLowerCase() === input.delivery!.county.trim().toLowerCase())) {
      throw new CheckoutError(`${zone.name} delivers to ${zone.counties.join(", ")}. Choose the zone that matches your county.`);
    }
  }

  const q = await quote({ lines: input.lines, fulfilment, deliveryZoneId: zone?.id, county: input.delivery?.county, couponCode: input.couponCode, userId: input.user?.id ?? null, phone: input.customer.phone });
  if (input.couponCode && q.couponError) throw new CheckoutError(q.couponError);

  const provisionalToken = randomToken(24);
  const holdMinutes = Math.max(5, options.holdMinutes);
  const expiresAt = new Date(Date.now() + holdMinutes * 60_000);
  const prefix = settingText(settings, "commerce.orderPrefix", "C254");
  const currency = settingText(settings, "commerce.currency", "KES");

  const order = await prisma.$transaction(async (tx) => {
    // Stock: reserve atomically so concurrent checkouts can never oversell.
    for (const line of q.lines) {
      if (line.itemType !== "PRODUCT" || !line.trackInventory || !line.variantId) continue;
      const reserved = await tx.$executeRaw`
        UPDATE "Inventory" SET "reserved" = "reserved" + ${line.quantity}, "updatedAt" = NOW()
        WHERE "variantId" = ${line.variantId} AND ("allowBackorder" = true OR "quantity" - "reserved" >= ${line.quantity})`;
      if (reserved !== 1) throw new CheckoutError(`${line.name}${line.detail ? ` (${line.detail})` : ""} doesn't have enough stock for that quantity.`);
    }

    const number = await nextOrderNumber(tx, prefix);
    const created = await tx.order.create({
      data: {
        number, userId: input.user?.id ?? null, status: "PENDING", fulfilment,
        customerName: input.customer.name, customerEmail: input.customer.email.toLowerCase(), customerPhone: input.customer.phone,
        deliveryZoneId: zone?.id ?? null, deliveryCounty: fulfilment === "DELIVERY" ? input.delivery!.county : null, deliveryTown: fulfilment === "DELIVERY" ? input.delivery!.town : null,
        deliveryAddress: fulfilment === "DELIVERY" ? input.delivery!.address : null, deliveryInstructions: fulfilment === "DELIVERY" ? input.delivery!.instructions ?? null : null,
        notes: input.notes || null, currency, subtotal: q.subtotal, discountTotal: q.discount, deliveryFee: q.deliveryFee, paymentFee: q.paymentFee, total: q.total,
        couponId: q.coupon?.id ?? null, couponCode: q.coupon?.code ?? null, accessTokenHash: sha256(provisionalToken), idempotencyKey: input.idempotencyKey, expiresAt,
        history: { create: { to: "PENDING", note: "Order placed", actorId: input.user?.id ?? null } },
      },
    });

    for (const line of q.lines) {
      const item = await tx.orderItem.create({
        data: {
          orderId: created.id, itemType: line.itemType, productId: line.productId ?? null, variantId: line.variantId ?? null,
          membershipPlanId: line.membershipPlanId ?? null, eventId: line.eventId ?? null, sessionTypeId: line.sessionTypeId ?? null,
          name: line.name, variantName: line.detail, sku: line.sku ?? null, imageUrl: line.imageUrl, unitPrice: line.unitPrice, originalUnitPrice: line.originalPrice,
          quantity: line.quantity, discount: line.discount, lineTotal: line.lineTotal - line.discount, requiresShipping: line.requiresShipping,
          metadata: line.itemType === "COACHING" ? { coachId: line.coachId, startsAt: line.startsAt?.toISOString(), endsAt: line.endsAt?.toISOString() } : undefined,
        },
      });

      if (line.itemType === "MEMBERSHIP") {
        await tx.membership.create({ data: { userId: input.user!.id, planId: line.membershipPlanId!, orderItemId: item.id, status: "PENDING" } });
      }

      if (line.itemType === "EVENT") {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"event:" + line.eventId}))`;
        const event = await tx.event.findUniqueOrThrow({ where: { id: line.eventId } });
        const prior = await tx.eventRegistration.findUnique({ where: { eventId_userId: { eventId: event.id, userId: input.user!.id } } });
        if (prior && (prior.status === "CONFIRMED" || prior.status === "ATTENDED")) throw new CheckoutError(`You're already registered for ${event.title}.`);
        const heldByMe = prior && prior.status === "PENDING" && prior.holdExpiresAt && prior.holdExpiresAt > new Date() ? 1 : 0;
        if (event.capacity !== null && (await eventSeatsTaken(event.id, tx)) - heldByMe >= event.capacity) throw new CheckoutError(`${event.title} is full.`);
        if (prior) await tx.eventRegistration.update({ where: { id: prior.id }, data: { status: "PENDING", holdExpiresAt: expiresAt, orderItemId: item.id, paymentId: null } });
        else await tx.eventRegistration.create({ data: { eventId: event.id, userId: input.user!.id, status: "PENDING", holdExpiresAt: expiresAt, orderItemId: item.id } });
      }

      if (line.itemType === "COACHING") {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"coach:" + line.coachId}))`;
        const clash = await tx.booking.count({
          where: {
            coachId: line.coachId!, startsAt: { lt: line.endsAt! }, endsAt: { gt: line.startsAt! },
            OR: [{ status: "CONFIRMED" }, { status: "PENDING", OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: new Date() } }] }],
          },
        });
        if (clash > 0) throw new CheckoutError("That time was just taken. Please pick another slot.");
        const memberClash = await tx.booking.count({
          where: { memberId: input.user!.id, startsAt: { lt: line.endsAt! }, endsAt: { gt: line.startsAt! }, OR: [{ status: "CONFIRMED" }, { status: "PENDING", holdExpiresAt: { gt: new Date() } }] },
        });
        if (memberClash > 0) throw new CheckoutError("You already have a session booked at that time.");
        await tx.booking.create({
          data: {
            memberId: input.user!.id, coachId: line.coachId!, sessionTypeId: line.sessionTypeId!, orderItemId: item.id, startsAt: line.startsAt!, endsAt: line.endsAt!,
            status: "PENDING", holdExpiresAt: expiresAt, notes: line.bookingNotes ?? null, history: { create: { status: "PENDING", actorId: input.user!.id, note: "Held for payment" } },
          },
        });
      }
    }

    await tx.order.update({ where: { id: created.id }, data: { accessTokenHash: sha256(orderAccessToken(created.id)) } });

    if (input.clearCartId) {
      await tx.cartItem.deleteMany({ where: { cartId: input.clearCartId } });
      await tx.cart.update({ where: { id: input.clearCartId }, data: { couponCode: null } });
    }
    return created;
  }, { timeout: 20_000 });

  return { order, accessToken: orderAccessToken(order.id), duplicate: false };
}
