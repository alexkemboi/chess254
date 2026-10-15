import "server-only";
import { prisma } from "@/server/db";
import { UserError } from "@/server/errors";
import { randomToken, sha256 } from "@/server/crypto";
import { getSettings } from "@/server/settings";
import { available, optionsLabel, parseOptions, priceOf } from "@/lib/shop";
import { publicProductWhere } from "./catalog";

export const CART_COOKIE = "mc_cart";
export const CART_COOKIE_DAYS = 60;

export async function findCart(token: string | null | undefined) {
  if (!token || token.length < 20 || token.length > 100) return null;
  return prisma.cart.findUnique({ where: { tokenHash: sha256(token) } });
}

export async function createCart(userId: string | null) {
  const token = randomToken(24);
  const cart = await prisma.cart.create({ data: { tokenHash: sha256(token), userId } });
  return { cart, token };
}

async function sellableVariant(variantId: string) {
  const variant = await prisma.productVariant.findFirst({ where: { id: variantId, active: true, product: publicProductWhere() }, include: { product: true } });
  if (!variant) throw new UserError("This item is no longer available.");
  return variant;
}

function limitFor(variant: { stockOnHand: number; stockReserved: number }, maxPerItem: number) {
  return Math.min(available(variant), maxPerItem);
}

/** Adds to the cart after checking the variant is on sale and in stock. Prices are never stored. */
export async function addToCart(cartId: string, variantId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new UserError("Choose a valid quantity.");
  const { maxQuantityPerItem } = await getSettings("shop");
  const variant = await sellableVariant(variantId);
  const existing = await prisma.cartItem.findUnique({ where: { cartId_variantId: { cartId, variantId } } });
  const wanted = (existing?.quantity ?? 0) + quantity;
  const limit = limitFor(variant, maxQuantityPerItem);
  if (limit <= 0) throw new UserError("Sorry, this item is out of stock.");
  if (wanted > limit) {
    throw new UserError(limit === maxQuantityPerItem && available(variant) > maxQuantityPerItem ? `You can buy up to ${maxQuantityPerItem} of each item.` : `Only ${limit} available${existing ? ` — you already have ${existing.quantity} in your cart` : ""}.`);
  }
  await prisma.cartItem.upsert({ where: { cartId_variantId: { cartId, variantId } }, create: { cartId, variantId, quantity: wanted }, update: { quantity: wanted } });
  await prisma.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });
}

export async function setCartQuantity(cartId: string, itemId: string, quantity: number) {
  const item = await prisma.cartItem.findFirst({ where: { id: itemId, cartId } });
  if (!item) throw new UserError("That item is no longer in your cart.");
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100) throw new UserError("Choose a valid quantity.");
  if (quantity === 0) {
    await prisma.cartItem.delete({ where: { id: item.id } });
    return;
  }
  const { maxQuantityPerItem } = await getSettings("shop");
  const variant = await sellableVariant(item.variantId);
  const limit = limitFor(variant, maxQuantityPerItem);
  if (quantity > item.quantity && quantity > limit) throw new UserError(limit <= 0 ? "Sorry, this item is out of stock." : `Only ${limit} available.`);
  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
}

export async function removeCartItem(cartId: string, itemId: string) {
  await prisma.cartItem.deleteMany({ where: { id: itemId, cartId } });
}

export type CartLine = {
  id: string;
  variantId: string;
  productId: string;
  slug: string;
  name: string;
  variantName: string | null;
  sku: string;
  image: string | null;
  unitPrice: number;
  regularPrice: number;
  quantity: number;
  lineTotal: number;
  maxQuantity: number;
  issue: null | "unavailable" | "insufficient";
};

export type CartView = { lines: CartLine[]; count: number; subtotal: number; currency: string; hasIssues: boolean };

/** Live view of a cart: current prices, stock and problems (sold out, unpublished, short). */
export async function cartView(cartId: string | null | undefined): Promise<CartView> {
  const { currency } = await getSettings("general");
  const { maxQuantityPerItem } = await getSettings("shop");
  if (!cartId) return { lines: [], count: 0, subtotal: 0, currency, hasIssues: false };
  const items = await prisma.cartItem.findMany({
    where: { cartId },
    orderBy: { createdAt: "asc" },
    include: { variant: { include: { product: { include: { images: { orderBy: { position: "asc" }, take: 1 }, category: true } } } } },
  });
  const lines: CartLine[] = items.map((item) => {
    const { variant } = item;
    const { product } = variant;
    const sellable = variant.active && product.status === "PUBLISHED" && !product.archivedAt && product.category.visible;
    const price = priceOf(product, variant);
    const limit = sellable ? limitFor(variant, maxQuantityPerItem) : 0;
    const issue = !sellable || limit <= 0 ? "unavailable" : item.quantity > limit ? "insufficient" : null;
    return {
      id: item.id,
      variantId: variant.id,
      productId: product.id,
      slug: product.slug,
      name: product.name,
      variantName: optionsLabel(parseOptions(variant.options)) || null,
      sku: variant.sku,
      image: product.images[0]?.url ?? null,
      unitPrice: price.effective,
      regularPrice: price.regular,
      quantity: item.quantity,
      lineTotal: Math.round(price.effective * item.quantity * 100) / 100,
      maxQuantity: limit,
      issue,
    };
  });
  const ok = lines.filter((l) => !l.issue);
  return {
    lines,
    count: lines.reduce((s, l) => s + l.quantity, 0),
    subtotal: Math.round(ok.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100,
    currency: items[0]?.variant.product.currency ?? currency,
    hasIssues: lines.some((l) => l.issue),
  };
}

export async function cartCount(cartId: string | null | undefined) {
  if (!cartId) return 0;
  const r = await prisma.cartItem.aggregate({ where: { cartId }, _sum: { quantity: true } });
  return r._sum.quantity ?? 0;
}

/** Housekeeping: carts nobody touched for 60 days. */
export async function pruneCarts() {
  const { count } = await prisma.cart.deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - CART_COOKIE_DAYS * 86400_000) }, orders: { none: {} } } });
  return count;
}
