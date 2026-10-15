import "server-only";
import type { StockMovementType } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import { UserError } from "@/server/errors";
import { getSettings } from "@/server/settings";
import { alertAdmins } from "@/server/notifications";
import { optionsLabel, parseOptions } from "@/lib/shop";

/**
 * Stock policy
 * ────────────
 * • Adding to the cart reserves nothing; availability = on hand − reserved.
 * • Placing an order RESERVES each line (conditional update, so concurrent
 *   checkouts can never take more than is available).
 * • A verified payment turns the reservation into a SALE (on hand and reserved
 *   both drop). Nothing is deducted on an STK request alone.
 * • An unpaid order that lapses or is cancelled RELEASES its reservation.
 * • Staff ADJUSTMENTS and RETURNS change stock on hand with a reason.
 * Every change writes a StockMovement row; the database CHECK constraint keeps
 * 0 ≤ reserved ≤ on hand even if a code path were wrong.
 */

type Line = { variantId: string; quantity: number; label?: string };
type Row = { stockOnHand: number; stockReserved: number };

async function log(tx: Tx, variantId: string, type: StockMovementType, quantity: number, reservedDelta: number, row: Row, extra: { reason?: string | null; shopOrderId?: string | null; actorId?: string | null } = {}) {
  await tx.stockMovement.create({
    data: { variantId, type, quantity, reservedDelta, onHandAfter: row.stockOnHand, reservedAfter: row.stockReserved, reason: extra.reason ?? null, shopOrderId: extra.shopOrderId ?? null, actorId: extra.actorId ?? null },
  });
}

/** Sorted so concurrent transactions lock variants in the same order (no deadlocks). */
const sorted = (lines: Line[]) => [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId));

export async function reserveStock(tx: Tx, lines: Line[], shopOrderId: string) {
  for (const line of sorted(lines)) {
    const rows = await tx.$queryRaw<Row[]>`
      UPDATE "ProductVariant" SET "stockReserved" = "stockReserved" + ${line.quantity}, "updatedAt" = now()
      WHERE "id" = ${line.variantId} AND "active" = true AND "stockOnHand" - "stockReserved" >= ${line.quantity}
      RETURNING "stockOnHand", "stockReserved"`;
    if (!rows.length) {
      const v = await tx.productVariant.findUnique({ where: { id: line.variantId }, select: { stockOnHand: true, stockReserved: true, active: true } });
      const left = v && v.active ? Math.max(0, v.stockOnHand - v.stockReserved) : 0;
      throw new UserError(left > 0 ? `Only ${left} of ${line.label ?? "an item"} left. Please update your cart.` : `${line.label ?? "An item"} just sold out. Please update your cart.`);
    }
    await log(tx, line.variantId, "RESERVE", 0, line.quantity, rows[0], { shopOrderId, reason: "Checkout" });
  }
}

export async function releaseStock(tx: Tx, lines: Line[], shopOrderId: string, reason: string) {
  for (const line of sorted(lines)) {
    const rows = await tx.$queryRaw<Row[]>`
      UPDATE "ProductVariant" SET "stockReserved" = GREATEST("stockReserved" - ${line.quantity}, 0), "updatedAt" = now()
      WHERE "id" = ${line.variantId}
      RETURNING "stockOnHand", "stockReserved"`;
    if (rows.length) await log(tx, line.variantId, "RELEASE", 0, -line.quantity, rows[0], { shopOrderId, reason });
  }
}

/**
 * Deducts sold stock after a verified payment. With a live reservation the
 * reserved units are consumed; otherwise (payment arrived after the hold
 * lapsed) only genuinely available units can be taken. Returns lines that
 * could not be fulfilled from stock.
 */
export async function commitStock(tx: Tx, lines: Line[], shopOrderId: string, reserved: boolean) {
  const shortfalls: Line[] = [];
  for (const line of sorted(lines)) {
    const rows = reserved
      ? await tx.$queryRaw<Row[]>`
          UPDATE "ProductVariant" SET "stockOnHand" = "stockOnHand" - ${line.quantity}, "stockReserved" = "stockReserved" - ${line.quantity}, "updatedAt" = now()
          WHERE "id" = ${line.variantId} AND "stockReserved" >= ${line.quantity} AND "stockOnHand" >= ${line.quantity}
          RETURNING "stockOnHand", "stockReserved"`
      : await tx.$queryRaw<Row[]>`
          UPDATE "ProductVariant" SET "stockOnHand" = "stockOnHand" - ${line.quantity}, "updatedAt" = now()
          WHERE "id" = ${line.variantId} AND "stockOnHand" - "stockReserved" >= ${line.quantity}
          RETURNING "stockOnHand", "stockReserved"`;
    if (!rows.length) {
      shortfalls.push(line);
      continue;
    }
    await log(tx, line.variantId, "SALE", -line.quantity, reserved ? -line.quantity : 0, rows[0], { shopOrderId, reason: "Payment verified" });
  }
  return shortfalls;
}

/** Puts sold units back on the shelf (cancelled or refunded paid orders). */
export async function returnStock(tx: Tx, lines: Line[], shopOrderId: string, actorId: string | null, reason: string) {
  for (const line of sorted(lines)) {
    const rows = await tx.$queryRaw<Row[]>`
      UPDATE "ProductVariant" SET "stockOnHand" = "stockOnHand" + ${line.quantity}, "lowStockAlertedAt" = NULL, "updatedAt" = now()
      WHERE "id" = ${line.variantId} RETURNING "stockOnHand", "stockReserved"`;
    if (rows.length) await log(tx, line.variantId, "RETURN", line.quantity, 0, rows[0], { shopOrderId, actorId, reason });
  }
}

/** Staff stock adjustment (positive = received, negative = damaged / lost / counted short). */
export async function adjustStock(tx: Tx, variantId: string, delta: number, input: { reason: string; actorId: string | null; type?: "ADJUSTMENT" | "INITIAL" }) {
  if (!Number.isInteger(delta) || delta === 0) throw new UserError("Enter a whole number other than zero.");
  const rows = await tx.$queryRaw<Row[]>`
    UPDATE "ProductVariant" SET "stockOnHand" = "stockOnHand" + ${delta}, "updatedAt" = now(),
      "lowStockAlertedAt" = CASE WHEN ${delta} > 0 THEN NULL ELSE "lowStockAlertedAt" END
    WHERE "id" = ${variantId} AND "stockOnHand" + ${delta} >= "stockReserved"
    RETURNING "stockOnHand", "stockReserved"`;
  if (!rows.length) {
    const v = await tx.productVariant.findUnique({ where: { id: variantId } });
    if (!v) throw new UserError("Variant not found.");
    throw new UserError(`Stock can't go below the ${v.stockReserved} units reserved by unpaid orders (on hand: ${v.stockOnHand}).`);
  }
  await log(tx, variantId, input.type ?? "ADJUSTMENT", delta, 0, rows[0], { reason: input.reason, actorId: input.actorId });
  return rows[0];
}

/** Effective low-stock threshold: variant → product → shop default. */
export function thresholdFor(variant: { lowStockThreshold: number | null }, product: { lowStockThreshold: number | null }, fallback: number) {
  return variant.lowStockThreshold ?? product.lowStockThreshold ?? fallback;
}

/** Alerts admins once when variants fall to their threshold (re-armed when restocked). Run after commit. */
export async function checkLowStock(variantIds: string[]) {
  const shop = await getSettings("shop");
  if (!shop.lowStockAlerts || !variantIds.length) return;
  const variants = await prisma.productVariant.findMany({ where: { id: { in: [...new Set(variantIds)] }, active: true, lowStockAlertedAt: null }, include: { product: true } });
  for (const v of variants) {
    const left = Math.max(0, v.stockOnHand - v.stockReserved);
    if (left > thresholdFor(v, v.product, shop.lowStockThreshold)) continue;
    const { count } = await prisma.productVariant.updateMany({ where: { id: v.id, lowStockAlertedAt: null }, data: { lowStockAlertedAt: new Date() } });
    if (!count) continue;
    const label = [v.product.name, optionsLabel(parseOptions(v.options))].filter(Boolean).join(" — ");
    await alertAdmins(left === 0 ? "Out of stock" : "Low stock", `${label} (${v.sku}) ${left === 0 ? "is out of stock" : `has ${left} left`}.`, "/admin/shop/inventory?filter=low").catch((e) => console.error("[shop] low stock alert", e));
  }
}
