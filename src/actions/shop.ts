"use server";
import { z } from "zod";
import { cookies } from "next/headers";
import { currentUser } from "@/server/auth";
import { runAction, parseForm, UserError, type ActionResult } from "@/server/errors";
import { clientIp } from "@/server/audit";
import { rateLimit } from "@/server/rate-limit";
import { addToCart, cartCount, CART_COOKIE, CART_COOKIE_DAYS, createCart, findCart, removeCartItem, setCartQuantity } from "@/server/shop/cart";
import { placeShopOrder, quoteCheckout } from "@/server/shop/checkout";
import { customerCancelShopOrder } from "@/server/shop/lifecycle";
import { shopOrderPath, verifyShopOrderKey } from "@/server/shop/links";
import { KENYA_COUNTIES } from "@/lib/kenya";

const id = z.string().min(1).max(40);

async function existingCart() {
  return findCart((await cookies()).get(CART_COOKIE)?.value);
}

async function ensureCart() {
  const existing = await existingCart();
  if (existing) return existing;
  const user = await currentUser();
  const { cart, token } = await createCart(user?.id ?? null);
  (await cookies()).set(CART_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: CART_COOKIE_DAYS * 86400 });
  return cart;
}

export async function addToCartAction(variantId: string, quantity: number): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    if (!(await rateLimit(`cart:${await clientIp()}`, 120, 600))) throw new UserError("Too many requests. Please slow down a little.");
    const cart = await ensureCart();
    await addToCart(cart.id, id.parse(variantId), z.coerce.number().int().parse(quantity));
    return { ok: true, message: "Added to your cart", data: { count: await cartCount(cart.id) } };
  });
}

export async function updateCartItemAction(itemId: string, quantity: number): Promise<ActionResult> {
  return runAction(async () => {
    const cart = await existingCart();
    if (!cart) throw new UserError("Your cart is empty.");
    await setCartQuantity(cart.id, id.parse(itemId), z.coerce.number().int().parse(quantity));
    return { ok: true };
  });
}

export async function removeCartItemAction(itemId: string): Promise<ActionResult> {
  return runAction(async () => {
    const cart = await existingCart();
    if (cart) await removeCartItem(cart.id, id.parse(itemId));
    return { ok: true, message: "Removed from your cart" };
  });
}

export type QuoteResult = { subtotal: number; discountAmount: number; discountCode: string | null; discountError: string | null; deliveryFee: number; deliveryError: string | null; total: number; hasIssues: boolean; count: number };

/** Live order summary for the checkout page — always computed on the server. */
export async function quoteCheckoutAction(input: { deliveryOptionId?: string; county?: string; discountCode?: string; email?: string }): Promise<ActionResult<QuoteResult>> {
  return runAction(async () => {
    const cart = await existingCart();
    const q = await quoteCheckout({
      cartId: cart?.id ?? null,
      deliveryOptionId: input.deliveryOptionId ? id.parse(input.deliveryOptionId) : null,
      county: input.county?.slice(0, 40) || null,
      discountCode: input.discountCode?.slice(0, 40) || null,
      email: input.email?.slice(0, 200) || null,
    });
    return { ok: true, data: { subtotal: q.subtotal, discountAmount: q.discountAmount, discountCode: q.discountCode, discountError: q.discountError, deliveryFee: q.deliveryFee, deliveryError: q.deliveryError, total: q.total, hasIssues: q.hasIssues, count: q.lines.reduce((s, l) => s + l.quantity, 0) } };
  });
}

const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

const checkoutSchema = z
  .object({
    checkoutKey: z.string().min(16).max(64),
    name: z.string().trim().min(2, "Enter your full name").max(120),
    email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
    phone: z.string().trim().transform((v) => v.replace(/[\s-]/g, "")).refine((v) => /^(?:\+?254|0)?[17]\d{8}$/.test(v), "Enter a valid Kenyan phone number, e.g. 0712 345 678"),
    method: z.enum(["DELIVERY", "COLLECTION"], { message: "Choose delivery or collection" }),
    deliveryOptionId: z.string().min(1, "Choose an option").max(40),
    county: z.union([z.literal(""), z.enum(KENYA_COUNTIES)]).optional().transform((v) => v || null),
    town: optional(80),
    address: optional(300),
    instructions: optional(500),
    discountCode: z.string().trim().toUpperCase().max(40).regex(/^[A-Z0-9_-]*$/, "Codes use letters and numbers only").optional().transform((v) => v || null),
  });

export async function placeOrderAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const data = parseForm(checkoutSchema, formData);
    if (!(await rateLimit(`shop-order:${await clientIp()}`, 15, 3600)) || !(await rateLimit(`shop-order:${data.email}`, 10, 3600))) throw new UserError("Too many orders in a short time. Please try again later.");
    const cart = await existingCart();
    if (!cart) throw new UserError("Your cart is empty.");
    const viewer = await currentUser();
    const order = await placeShopOrder({ ...data, cartId: cart.id, idempotencyKey: data.checkoutKey, viewerId: viewer?.id ?? null });
    return { ok: true, message: `Order ${order.number} placed — complete the M-Pesa payment to confirm it.`, redirect: shopOrderPath(order.number) };
  });
}

export async function cancelShopOrderAction(number: string, key: string): Promise<ActionResult> {
  return runAction(async () => {
    const n = z.string().min(3).max(30).parse(number);
    if (!verifyShopOrderKey(n, key)) throw new UserError("This order link is not valid.");
    await customerCancelShopOrder(n);
    return { ok: true, message: "Order cancelled. Your cart still has the items if you change your mind." };
  });
}
