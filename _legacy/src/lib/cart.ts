import "server-only";
import { cookies } from "next/headers";
import type { ItemType, Prisma, Promotion } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { randomToken, sha256 } from "@/lib/crypto";
import { eventQuote, getActivePromotions, hasActiveMembership, membershipQuote, productQuote, type PriceQuote } from "@/lib/pricing";

export const CART_COOKIE = "chess254_cart";
const CART_DAYS = 30;

const cartInclude = {
  items: {
    orderBy: { createdAt: "asc" },
    include: {
      variant: { include: { inventory: true, product: { include: { images: { orderBy: { position: "asc" }, take: 1 }, category: true } } } },
      membershipPlan: true,
      event: true,
    },
  },
} satisfies Prisma.CartInclude;

export type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>;

export type CartLine = {
  id: string;
  itemType: ItemType;
  name: string;
  detail: string | null;
  href: string;
  imageUrl: string | null;
  quantity: number;
  maxQuantity: number;
  unit: PriceQuote;
  lineTotal: number;
  requiresShipping: boolean;
  requiresAccount: boolean;
  issue: string | null;
  refs: { productId?: string; variantId?: string; categoryId?: string | null; sku?: string; trackInventory?: boolean; membershipPlanId?: string; eventId?: string };
};

export type CartView = {
  id: string | null;
  currency: string;
  lines: CartLine[];
  count: number;
  subtotal: number;
  requiresShipping: boolean;
  requiresAccount: boolean;
  hasIssues: boolean;
  couponCode: string | null;
};

const EMPTY: CartView = { id: null, currency: "KES", lines: [], count: 0, subtotal: 0, requiresShipping: false, requiresAccount: false, hasIssues: false, couponCode: null };

async function guestTokenHash() {
  const token = (await cookies()).get(CART_COOKIE)?.value;
  return token ? sha256(token) : null;
}

/** Finds the active cart without creating one (safe in Server Components). */
export async function findCart() {
  const user = await currentUser();
  if (user) return prisma.cart.findUnique({ where: { userId: user.id }, include: cartInclude });
  const hash = await guestTokenHash();
  return hash ? prisma.cart.findUnique({ where: { guestTokenHash: hash }, include: cartInclude }) : null;
}

/** Finds or creates the cart. Only callable from Server Actions / Route Handlers (sets a cookie). */
export async function ensureCart() {
  const user = await currentUser();
  if (user) return prisma.cart.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {}, select: { id: true } });
  const jar = await cookies();
  const existing = jar.get(CART_COOKIE)?.value;
  if (existing) {
    const cart = await prisma.cart.findUnique({ where: { guestTokenHash: sha256(existing) }, select: { id: true } });
    if (cart) return cart;
  }
  const token = randomToken();
  jar.set(CART_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: CART_DAYS * 86400 });
  return prisma.cart.create({ data: { guestTokenHash: sha256(token) }, select: { id: true } });
}

/** Moves a guest cart into the signed-in user's cart (called right after login/registration). */
export async function mergeGuestCart(userId: string) {
  const jar = await cookies();
  const token = jar.get(CART_COOKIE)?.value;
  if (!token) return;
  const guest = await prisma.cart.findUnique({ where: { guestTokenHash: sha256(token) }, include: { items: true } });
  jar.delete(CART_COOKIE);
  if (!guest) return;
  await prisma.$transaction(async (tx) => {
    const target = await tx.cart.upsert({ where: { userId }, create: { userId, couponCode: guest.couponCode }, update: guest.couponCode ? { couponCode: guest.couponCode } : {} });
    for (const item of guest.items) {
      const { id: _id, cartId: _cartId, createdAt: _c, updatedAt: _u, ...data } = item;
      void _id; void _cartId; void _c; void _u;
      await tx.cartItem.upsert({
        where: { cartId_itemKey: { cartId: target.id, itemKey: item.itemKey } },
        create: { ...data, cartId: target.id },
        update: item.itemType === "PRODUCT" ? { quantity: { increment: item.quantity } } : {},
      });
    }
    await tx.cart.delete({ where: { id: guest.id } });
  });
}

/** Seats currently taken: confirmed registrations plus unexpired payment holds. */
export async function eventSeatsTaken(eventId: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
  return client.eventRegistration.count({
    where: { eventId, OR: [{ status: { in: ["CONFIRMED", "ATTENDED"] } }, { status: "PENDING", holdExpiresAt: { gt: new Date() } }] },
  });
}

export function availableStock(inventory: { quantity: number; reserved: number; allowBackorder: boolean } | null | undefined, tracked: boolean) {
  if (!tracked) return Number.POSITIVE_INFINITY;
  if (!inventory) return 0;
  if (inventory.allowBackorder) return Number.POSITIVE_INFINITY;
  return Math.max(0, inventory.quantity - inventory.reserved);
}

export async function buildCartView(cart: CartWithItems | null): Promise<CartView> {
  if (!cart) return EMPTY;
  const [promotions, user] = await Promise.all([getActivePromotions(), currentUser()]);
  const isMember = await hasActiveMembership(user?.id);
  const lines = await Promise.all(cart.items.map((item) => describeLine(item, promotions, isMember, user?.id ?? null)));
  const valid = lines.filter((l): l is CartLine => l !== null);
  const subtotal = valid.reduce((sum, l) => sum + (l.issue ? 0 : l.lineTotal), 0);
  return {
    id: cart.id,
    currency: currencyOf(cart),
    lines: valid,
    count: valid.reduce((n, l) => n + l.quantity, 0),
    subtotal,
    requiresShipping: valid.some((l) => l.requiresShipping && !l.issue),
    requiresAccount: valid.some((l) => l.requiresAccount && !l.issue),
    hasIssues: valid.some((l) => l.issue),
    couponCode: cart.couponCode,
  };
}

function currencyOf(cart: CartWithItems) {
  const first = cart.items[0];
  return first?.variant?.product.currency ?? first?.membershipPlan?.currency ?? first?.event?.currency ?? "KES";
}

async function describeLine(item: CartWithItems["items"][number], promotions: Promotion[], isMember: boolean, userId: string | null): Promise<CartLine | null> {
  if (item.itemType === "PRODUCT" && item.variant) {
    const { variant } = item;
    const product = variant.product;
    const unit = productQuote(product, variant, promotions);
    const stock = availableStock(variant.inventory, product.trackInventory);
    const cap = Math.min(stock, product.maxPerOrder ?? 99, 99);
    let issue: string | null = null;
    if (product.status !== "ACTIVE" || !variant.active) issue = "No longer available";
    else if (stock <= 0) issue = "Out of stock";
    else if (item.quantity > cap) issue = cap === stock ? `Only ${stock} left in stock` : `Maximum ${cap} per order`;
    const quantity = item.quantity;
    return {
      id: item.id, itemType: "PRODUCT", name: product.name, detail: variant.name === "Default" ? null : variant.name,
      href: `/shop/${product.slug}`, imageUrl: product.images[0]?.url ?? null, quantity, maxQuantity: Number.isFinite(cap) ? cap : 99,
      unit, lineTotal: unit.unitPrice * quantity, requiresShipping: product.type === "PHYSICAL", requiresAccount: false, issue,
      refs: { productId: product.id, variantId: variant.id, categoryId: product.categoryId, sku: variant.sku, trackInventory: product.trackInventory },
    };
  }
  if (item.itemType === "MEMBERSHIP" && item.membershipPlan) {
    const plan = item.membershipPlan;
    const unit = membershipQuote(plan, promotions);
    return {
      id: item.id, itemType: "MEMBERSHIP", name: `${plan.name} membership`, detail: plan.billingPeriod.toLowerCase(), href: `/memberships/${plan.slug}`,
      imageUrl: plan.imageUrl, quantity: 1, maxQuantity: 1, unit, lineTotal: unit.unitPrice, requiresShipping: false, requiresAccount: true,
      issue: plan.status !== "ACTIVE" ? "This plan is no longer offered" : null, refs: { membershipPlanId: plan.id },
    };
  }
  if (item.itemType === "EVENT" && item.event) {
    const event = item.event;
    const unit = eventQuote(event, isMember, promotions);
    let issue: string | null = null;
    const now = new Date();
    if (event.status !== "PUBLISHED") issue = "Registration is closed";
    else if (event.startsAt <= now || (event.registrationDeadline && event.registrationDeadline < now)) issue = "Registration has closed";
    else if (event.capacity !== null && (await eventSeatsTaken(event.id)) >= event.capacity) issue = "This event is full";
    else if (userId && (await prisma.eventRegistration.count({ where: { eventId: event.id, userId, status: { in: ["CONFIRMED", "ATTENDED"] } } }))) issue = "You are already registered";
    return {
      id: item.id, itemType: "EVENT", name: event.title, detail: event.type === "TOURNAMENT" ? "Tournament entry" : "Event registration", href: `/events/${event.slug}`,
      imageUrl: event.coverImage, quantity: 1, maxQuantity: 1, unit, lineTotal: unit.unitPrice, requiresShipping: false, requiresAccount: true, issue,
      refs: { eventId: event.id },
    };
  }
  return null;
}

export async function getCartView() {
  return buildCartView(await findCart());
}

export async function cartCount() {
  const user = await currentUser();
  const where: Prisma.CartItemWhereInput | null = user ? { cart: { userId: user.id } } : (await guestTokenHash()) ? { cart: { guestTokenHash: (await guestTokenHash())! } } : null;
  if (!where) return 0;
  const agg = await prisma.cartItem.aggregate({ where, _sum: { quantity: true } }).catch(() => null);
  return agg?._sum.quantity ?? 0;
}

export const itemKeyFor = (type: ItemType, id: string) => `${type}:${id}`;

export function lineDiscountBase(lines: CartLine[]) {
  return lines.filter((l) => !l.issue).map((l) => ({ ...l.refs, itemType: l.itemType, amount: l.lineTotal }));
}

