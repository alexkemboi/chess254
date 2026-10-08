import "server-only";
import { cache } from "react";
import type { DiscountScope, DiscountType, Prisma, Promotion } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/format";

export type PriceTarget =
  | { kind: "PRODUCT"; productId: string; categoryId: string | null }
  | { kind: "MEMBERSHIP"; planId: string }
  | { kind: "EVENT"; eventId: string }
  | { kind: "COACHING"; sessionTypeId: string };

export type PriceQuote = { unitPrice: number; originalPrice: number; onSale: boolean; promotion: { id: string; name: string } | null };

export const activeWindow = (now = new Date()): Prisma.PromotionWhereInput => ({
  active: true,
  AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
});

export const getActivePromotions = cache(async () => {
  try {
    return await prisma.promotion.findMany({ where: activeWindow(), orderBy: [{ priority: "desc" }, { createdAt: "desc" }] });
  } catch {
    return [] as Promotion[];
  }
});

export function scopeMatches(scope: DiscountScope, categoryIds: string[], productIds: string[], target: PriceTarget) {
  switch (scope) {
    case "ALL": return true;
    case "PRODUCTS": return target.kind === "PRODUCT";
    case "CATEGORY": return target.kind === "PRODUCT" && !!target.categoryId && categoryIds.includes(target.categoryId);
    case "PRODUCT": return target.kind === "PRODUCT" && productIds.includes(target.productId);
    case "MEMBERSHIPS": return target.kind === "MEMBERSHIP";
    case "EVENTS": return target.kind === "EVENT";
    case "COACHING": return target.kind === "COACHING";
  }
}

export function discounted(price: number, type: DiscountType, value: number) {
  if (type === "PERCENTAGE") return Math.max(0, price - Math.round((price * Math.min(value, 100)) / 100));
  if (type === "FIXED") return Math.max(0, price - Math.round(value));
  return price;
}

/** Best price for the customer among base, sale and automatic promotions. Discounts never stack. */
export function quotePrice(base: number, sale: number | null, target: PriceTarget, promotions: Promotion[]): PriceQuote {
  const originalPrice = Math.round(base);
  let best: PriceQuote = { unitPrice: originalPrice, originalPrice, onSale: false, promotion: null };
  if (sale !== null && sale >= 0 && sale < best.unitPrice) best = { unitPrice: Math.round(sale), originalPrice, onSale: true, promotion: null };
  for (const promo of promotions) {
    if (promo.type === "FREE_DELIVERY" || !scopeMatches(promo.scope, promo.categoryIds, promo.productIds, target)) continue;
    const price = discounted(originalPrice, promo.type, toNumber(promo.value));
    if (price < best.unitPrice) best = { unitPrice: price, originalPrice, onSale: true, promotion: { id: promo.id, name: promo.name } };
  }
  return best;
}

type SaleWindow = { saleStartsAt: Date | null; saleEndsAt: Date | null };
export function saleActive(window: SaleWindow, now = new Date()) {
  return (!window.saleStartsAt || window.saleStartsAt <= now) && (!window.saleEndsAt || window.saleEndsAt >= now);
}

type ProductForPrice = SaleWindow & { id: string; categoryId: string | null; price: Prisma.Decimal; salePrice: Prisma.Decimal | null };
type VariantForPrice = { price: Prisma.Decimal | null; salePrice: Prisma.Decimal | null } | null | undefined;

export function productQuote(product: ProductForPrice, variant: VariantForPrice, promotions: Promotion[]) {
  const base = toNumber(variant?.price ?? product.price);
  const saleSource = variant?.salePrice ?? (variant?.price ? null : product.salePrice);
  const sale = saleSource !== null && saleSource !== undefined && saleActive(product) ? toNumber(saleSource) : null;
  return quotePrice(base, sale, { kind: "PRODUCT", productId: product.id, categoryId: product.categoryId }, promotions);
}

export function membershipQuote(plan: { id: string; price: Prisma.Decimal; salePrice: Prisma.Decimal | null }, promotions: Promotion[]) {
  return quotePrice(toNumber(plan.price), plan.salePrice === null ? null : toNumber(plan.salePrice), { kind: "MEMBERSHIP", planId: plan.id }, promotions);
}

export function eventQuote(event: { id: string; price: Prisma.Decimal; memberPrice: Prisma.Decimal | null }, isMember: boolean, promotions: Promotion[]) {
  const member = isMember && event.memberPrice !== null ? toNumber(event.memberPrice) : null;
  return quotePrice(toNumber(event.price), member, { kind: "EVENT", eventId: event.id }, promotions);
}

export function coachingQuote(sessionType: { id: string; price: Prisma.Decimal }, promotions: Promotion[]) {
  return quotePrice(toNumber(sessionType.price), null, { kind: "COACHING", sessionTypeId: sessionType.id }, promotions);
}

export async function hasActiveMembership(userId: string | null | undefined) {
  if (!userId) return false;
  const count = await prisma.membership.count({ where: { userId, status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
  return count > 0;
}
