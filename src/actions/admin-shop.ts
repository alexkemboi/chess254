"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { assertPermission } from "@/server/auth";
import { can } from "@/server/rbac";
import { audit } from "@/server/audit";
import { runAction, parseForm, UserError, type ActionResult } from "@/server/errors";
import { addShopOrderNote, transitionShopOrder, updateFulfilment } from "@/server/shop/lifecycle";
import { adjustStock, checkLowStock } from "@/server/shop/inventory";
import { SHOP_STATUSES } from "@/lib/shop";

const id = z.string().min(1).max(40);
const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const bool = z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean());

export async function transitionShopOrderAction(orderId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertPermission("shop.orders");
    const data = parseForm(
      z.object({ to: z.enum(SHOP_STATUSES as [string, ...string[]]), note: opt(1000), courier: opt(80), trackingNumber: opt(80), collectedBy: opt(120), refundReference: opt(80), restock: bool.optional(), notify: bool.optional() }),
      formData,
    );
    const order = await prisma.shopOrder.findUnique({ where: { id: id.parse(orderId) }, select: { paidAt: true } });
    if (!order) throw new UserError("Order not found.");
    if ((data.to === "REFUNDED" || (data.to === "CANCELLED" && order.paidAt)) && !(await can(user.role, "shop.refunds"))) throw new UserError("Cancelling paid orders and recording refunds needs the refunds permission.");
    await transitionShopOrder(orderId, { to: data.to as (typeof SHOP_STATUSES)[number], note: data.note, courier: data.courier, trackingNumber: data.trackingNumber, collectedBy: data.collectedBy, refundReference: data.refundReference, restock: data.restock, notifyCustomer: data.notify !== false }, user.id);
    revalidatePath("/admin/shop", "layout");
    return { ok: true, message: "Order updated." };
  });
}

export async function updateFulfilmentAction(orderId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertPermission("shop.orders");
    const data = parseForm(z.object({ courier: opt(80), trackingNumber: opt(80), collectedBy: opt(120), fulfillmentNotes: opt(2000) }), formData);
    await updateFulfilment(id.parse(orderId), data, user.id);
    return { ok: true, message: "Fulfilment details saved." };
  });
}

export async function addShopOrderNoteAction(orderId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertPermission("shop.orders");
    const { note } = parseForm(z.object({ note: z.string().trim().min(1, "Write a note").max(2000) }), formData);
    await addShopOrderNote(id.parse(orderId), note, user.id);
    return { ok: true, message: "Note added." };
  });
}

export async function adjustStockAction(variantId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertPermission("shop.inventory");
    const data = parseForm(
      z.object({
        direction: z.enum(["in", "out", "set"]),
        quantity: z.coerce.number({ message: "Enter a number" }).int("Whole numbers only").min(0).max(100000),
        reason: z.string().trim().min(2, "Give a reason").max(120),
        note: opt(300),
      }),
      formData,
    );
    const variant = await prisma.productVariant.findUnique({ where: { id: id.parse(variantId) } });
    if (!variant) throw new UserError("Variant not found.");
    const delta = data.direction === "set" ? data.quantity - variant.stockOnHand : data.direction === "in" ? data.quantity : -data.quantity;
    if (delta === 0) throw new UserError("That doesn't change the stock.");
    const row = await prisma.$transaction((tx) => adjustStock(tx, variant.id, delta, { reason: [data.reason, data.note].filter(Boolean).join(" — "), actorId: user.id }));
    await audit({ actorId: user.id, action: "inventory.adjust", entity: "ProductVariant", entityId: variant.id, previous: { stockOnHand: variant.stockOnHand }, next: { stockOnHand: row.stockOnHand, delta, reason: data.reason, note: data.note } });
    await checkLowStock([variant.id]);
    revalidatePath("/shop", "layout");
    return { ok: true, message: `Stock is now ${row.stockOnHand} (${delta > 0 ? "+" : ""}${delta}).` };
  });
}

export async function setProductStatusAction(productId: string, status: "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED" | "DRAFT"): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertPermission("shop.products");
    const next = z.enum(["PUBLISHED", "UNPUBLISHED", "ARCHIVED", "DRAFT"]).parse(status);
    const product = await prisma.product.findUnique({ where: { id: id.parse(productId) }, include: { variants: { where: { active: true } } } });
    if (!product) throw new UserError("Product not found.");
    if (next === "PUBLISHED") {
      if (!product.variants.length) throw new UserError("Add stock or a variant before publishing.");
      if (product.price.lessThanOrEqualTo(0) && !product.variants.some((v) => v.price?.greaterThan(0))) throw new UserError("Set a price before publishing.");
    }
    await prisma.product.update({ where: { id: product.id }, data: { status: next, publishedAt: next === "PUBLISHED" ? (product.publishedAt ?? new Date()) : product.publishedAt, archivedAt: next === "ARCHIVED" ? new Date() : null, ...(next === "ARCHIVED" ? { featured: false } : {}) } });
    await audit({ actorId: user.id, action: `products.${next.toLowerCase()}`, entity: "products", entityId: product.id, previous: { status: product.status }, next: { status: next } });
    revalidatePath("/", "layout");
    return { ok: true, message: next === "PUBLISHED" ? "Published — it's live in the shop." : next === "ARCHIVED" ? "Archived." : "Hidden from the shop." };
  });
}
