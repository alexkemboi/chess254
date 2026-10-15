import "server-only";
import { Prisma, type ShopOrderStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { getAllSettings } from "@/server/settings";
import { addDaysToKey, dateKeyInZone, zonedTimeToUtc } from "@/lib/time";
import { available, optionsLabel, parseOptions, SHOP_STATUSES } from "@/lib/shop";
import { thresholdFor } from "./inventory";

export type Range = { from: Date; to: Date; fromKey: string; toKey: string };

/** Date range in the club timezone; defaults to the last 30 days. `to` is exclusive (start of the day after). */
export async function rangeFrom(sp: { from?: string; to?: string }): Promise<Range> {
  const tz = (await getAllSettings()).general.timezone;
  const today = dateKeyInZone(new Date(), tz);
  const valid = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const toKey = valid(sp.to) ?? today;
  const fromKey = valid(sp.from) ?? addDaysToKey(toKey, -29);
  const [a, b] = fromKey <= toKey ? [fromKey, toKey] : [toKey, fromKey];
  return { fromKey: a, toKey: b, from: zonedTimeToUtc(a, "00:00", tz), to: zonedTimeToUtc(addDaysToKey(b, 1), "00:00", tz) };
}

/** Orders that count as sales: paid and not refunded. */
const SOLD: ShopOrderStatus[] = ["PAID", "PROCESSING", "READY_FOR_COLLECTION", "SHIPPED", "DELIVERED"];

export async function statusCounts(range?: Range) {
  const rows = await prisma.shopOrder.groupBy({ by: ["status"], _count: { _all: true }, _sum: { total: true }, where: range ? { createdAt: { gte: range.from, lt: range.to } } : {} });
  const counts = Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Partial<Record<ShopOrderStatus, number>>;
  return { counts, total: rows.reduce((s, r) => s + r._count._all, 0) };
}

export async function salesSummary(range: Range) {
  const [sold, refunded] = await Promise.all([
    prisma.shopOrder.aggregate({ where: { status: { in: SOLD }, paidAt: { gte: range.from, lt: range.to } }, _sum: { total: true, deliveryFee: true, discountTotal: true }, _count: { _all: true } }),
    prisma.shopOrder.aggregate({ where: { status: "REFUNDED", refundedAt: { gte: range.from, lt: range.to } }, _sum: { total: true }, _count: { _all: true } }),
  ]);
  const revenue = sold._sum.total?.toNumber() ?? 0;
  return { revenue, orders: sold._count._all, average: sold._count._all ? revenue / sold._count._all : 0, delivery: sold._sum.deliveryFee?.toNumber() ?? 0, discounts: sold._sum.discountTotal?.toNumber() ?? 0, refunded: refunded._sum.total?.toNumber() ?? 0, refunds: refunded._count._all };
}

export async function salesByDay(range: Range) {
  const tz = (await getAllSettings()).general.timezone;
  const rows = await prisma.$queryRaw<{ day: string; total: Prisma.Decimal; orders: bigint }[]>`
    SELECT to_char(("paidAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, SUM("total") AS total, COUNT(*) AS orders
    FROM "ShopOrder" WHERE "status"::text = ANY(${SOLD}) AND "paidAt" >= ${range.from} AND "paidAt" < ${range.to}
    GROUP BY 1 ORDER BY 1`;
  const byDay = new Map(rows.map((r) => [r.day, { total: Number(r.total), orders: Number(r.orders) }]));
  const out: { date: string; total: number; orders: number }[] = [];
  for (let key = range.fromKey; key <= range.toKey; key = addDaysToKey(key, 1)) out.push({ date: key, ...(byDay.get(key) ?? { total: 0, orders: 0 }) });
  return out;
}

export async function salesByProduct(range: Range | null, take = 50) {
  return prisma.$queryRaw<{ productId: string; name: string; category: string; quantity: bigint; revenue: Prisma.Decimal; orders: bigint }[]>`
    SELECT i."productId", MAX(i."productName") AS name, MAX(c."name") AS category, SUM(i."quantity") AS quantity, SUM(i."total") AS revenue, COUNT(DISTINCT o."id") AS orders
    FROM "ShopOrderItem" i JOIN "ShopOrder" o ON o."id" = i."shopOrderId" JOIN "Product" p ON p."id" = i."productId" JOIN "ProductCategory" c ON c."id" = p."categoryId"
    WHERE o."status"::text = ANY(${SOLD}) ${range ? Prisma.sql`AND o."paidAt" >= ${range.from} AND o."paidAt" < ${range.to}` : Prisma.empty}
    GROUP BY i."productId" ORDER BY quantity DESC, revenue DESC LIMIT ${take}`;
}

export async function salesByCategory(range: Range) {
  return prisma.$queryRaw<{ category: string; quantity: bigint; revenue: Prisma.Decimal }[]>`
    SELECT c."name" AS category, SUM(i."quantity") AS quantity, SUM(i."total") AS revenue
    FROM "ShopOrderItem" i JOIN "ShopOrder" o ON o."id" = i."shopOrderId" JOIN "Product" p ON p."id" = i."productId" JOIN "ProductCategory" c ON c."id" = p."categoryId"
    WHERE o."status"::text = ANY(${SOLD}) AND o."paidAt" >= ${range.from} AND o."paidAt" < ${range.to}
    GROUP BY c."name" ORDER BY revenue DESC`;
}

export type StockRow = { variantId: string; productId: string; product: string; variant: string; sku: string; status: string; onHand: number; reserved: number; available: number; threshold: number; state: "out" | "low" | "ok"; active: boolean };

export async function stockReport(filter: "all" | "low" | "out" = "all", q?: string) {
  const shop = (await getAllSettings()).shop;
  const variants = await prisma.productVariant.findMany({
    where: { product: { archivedAt: null }, ...(q ? { OR: [{ sku: { contains: q, mode: "insensitive" } }, { product: { name: { contains: q, mode: "insensitive" } } }] } : {}) },
    include: { product: true },
    orderBy: [{ product: { name: "asc" } }, { position: "asc" }],
  });
  const rows: StockRow[] = variants
    .filter((v) => v.active || v.stockOnHand > 0 || v.stockReserved > 0)
    .map((v) => {
      const left = available(v);
      const threshold = thresholdFor(v, v.product, shop.lowStockThreshold);
      return { variantId: v.id, productId: v.productId, product: v.product.name, variant: optionsLabel(parseOptions(v.options)) || "—", sku: v.sku, status: v.product.status, onHand: v.stockOnHand, reserved: v.stockReserved, available: left, threshold, state: left === 0 ? "out" : left <= threshold ? "low" : "ok", active: v.active };
    });
  return filter === "all" ? rows : rows.filter((r) => r.active && (filter === "out" ? r.state === "out" : r.state !== "ok"));
}

/** Time from payment to dispatch/ready and to delivery, plus orders waiting too long. */
export async function fulfilmentPerformance(range: Range) {
  const rows = await prisma.$queryRaw<{ method: string; orders: bigint; dispatched: bigint; delivered: bigint; avg_dispatch_h: number | null; avg_deliver_h: number | null }[]>`
    SELECT "fulfillmentMethod"::text AS method, COUNT(*) AS orders,
      COUNT(*) FILTER (WHERE COALESCE("shippedAt", "readyAt") IS NOT NULL) AS dispatched,
      COUNT(*) FILTER (WHERE "deliveredAt" IS NOT NULL) AS delivered,
      AVG(EXTRACT(EPOCH FROM (COALESCE("shippedAt", "readyAt") - "paidAt")) / 3600) AS avg_dispatch_h,
      AVG(EXTRACT(EPOCH FROM ("deliveredAt" - "paidAt")) / 3600) AS avg_deliver_h
    FROM "ShopOrder" WHERE "paidAt" >= ${range.from} AND "paidAt" < ${range.to} AND "status" <> 'CANCELLED'
    GROUP BY 1`;
  const waiting = await prisma.shopOrder.findMany({ where: { status: { in: ["PAID", "PROCESSING"] }, paidAt: { lt: new Date(Date.now() - 48 * 3600_000) } }, orderBy: { paidAt: "asc" }, take: 20, select: { id: true, number: true, customerName: true, paidAt: true, status: true, fulfillmentMethod: true } });
  return { rows: rows.map((r) => ({ method: r.method, orders: Number(r.orders), dispatched: Number(r.dispatched), delivered: Number(r.delivered), avgDispatchHours: r.avg_dispatch_h === null ? null : Number(r.avg_dispatch_h), avgDeliverHours: r.avg_deliver_h === null ? null : Number(r.avg_deliver_h) })), waiting };
}

/**
 * Payment reconciliation: every paid shop order against its M-Pesa payment, and
 * the exceptions staff must look at (money without a paid order, paid orders
 * without verified money, amount differences, paid after the hold lapsed).
 */
export async function reconciliation(range: Range) {
  const orders = await prisma.shopOrder.findMany({
    where: { OR: [{ paidAt: { gte: range.from, lt: range.to } }, { createdAt: { gte: range.from, lt: range.to } }] },
    include: { order: { include: { payments: { orderBy: { createdAt: "desc" } } } }, events: { where: { kind: "STOCK" }, select: { id: true } } },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  const rows = orders.map((o) => {
    const success = o.order.payments.find((p) => p.status === "SUCCESS" || p.status === "REFUNDED");
    const issues: string[] = [];
    if (o.paidAt && !success) issues.push("Marked paid without a verified payment");
    if (!o.paidAt && o.order.payments.some((p) => p.status === "SUCCESS")) issues.push("Verified payment but order not paid");
    if (success && Math.round(success.amount.toNumber()) !== Math.ceil(o.total.toNumber())) issues.push("Amount differs from order total");
    if (o.paidAt && o.order.status !== "PAID" && o.order.status !== "REFUNDED") issues.push(`Payment order is ${o.order.status.toLowerCase()}`);
    if (o.events.length) issues.push("Paid after stock hold lapsed");
    if (o.status === "CANCELLED" && o.paidAt) issues.push("Cancelled after payment — refund due");
    return { id: o.id, number: o.number, customer: o.customerName, status: o.status, total: o.total.toNumber(), paidAt: o.paidAt, receipt: success?.receiptNumber ?? null, amount: success?.amount.toNumber() ?? null, phone: success?.phoneNumber ?? null, attempts: o.order.payments.length, refundReference: o.refundReference, issues };
  });
  return { rows, exceptions: rows.filter((r) => r.issues.length) };
}

export async function cancelledAndRefunded(range: Range) {
  return prisma.shopOrder.findMany({
    where: { status: { in: ["CANCELLED", "REFUNDED"] }, OR: [{ cancelledAt: { gte: range.from, lt: range.to } }, { refundedAt: { gte: range.from, lt: range.to } }] },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, number: true, customerName: true, status: true, total: true, paidAt: true, cancelReason: true, refundReference: true, cancelledAt: true, refundedAt: true },
  });
}

/** Admin order list / export filters (search, status, method, date range in club time). */
export function shopOrderWhere(sp: Record<string, string | undefined>, tz: string): Prisma.ShopOrderWhereInput {
  const q = sp.q?.trim().slice(0, 80);
  const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const from = date(sp.from);
  const to = date(sp.to);
  return {
    ...(SHOP_STATUSES.includes(sp.status as ShopOrderStatus) ? { status: sp.status as ShopOrderStatus } : {}),
    ...(sp.method === "DELIVERY" || sp.method === "COLLECTION" ? { fulfillmentMethod: sp.method } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: zonedTimeToUtc(from, "00:00", tz) } : {}), ...(to ? { lt: zonedTimeToUtc(addDaysToKey(to, 1), "00:00", tz) } : {}) } } : {}),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { customerName: { contains: q, mode: "insensitive" } }, { customerEmail: { contains: q, mode: "insensitive" } }, { customerPhone: { contains: q.replace(/\s/g, "") } }, { trackingNumber: { contains: q, mode: "insensitive" } }, { items: { some: { OR: [{ productName: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } } }] } : {}),
  };
}
