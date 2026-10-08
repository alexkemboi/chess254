import "server-only";
import { Prisma, type BillingPeriod, type OrderItemType } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import { getSettings } from "@/server/settings";
import { randomToken } from "@/server/crypto";

export async function nextCounter(key: string, tx: Tx | typeof prisma = prisma) {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  return rows[0].value;
}

export async function nextOrderNumber(tx: Tx) {
  const year = new Date().getUTCFullYear().toString().slice(-2);
  const seq = await nextCounter(`order:${year}`, tx);
  return `C${year}${String(seq).padStart(5, "0")}`;
}

export async function nextInvoiceNumber(tx: Tx) {
  const { invoicePrefix } = await getSettings("payments");
  const year = new Date().getUTCFullYear();
  const seq = await nextCounter(`invoice:${year}`, tx);
  return `${invoicePrefix}-${year}-${String(seq).padStart(5, "0")}`;
}

export function addBillingPeriod(from: Date, period: BillingPeriod) {
  const d = new Date(from);
  switch (period) {
    case "DAILY":
      return new Date(d.getTime() + 86400_000);
    case "WEEKLY":
      return new Date(d.getTime() + 7 * 86400_000);
    case "MONTHLY":
    case "QUARTERLY":
    case "ANNUAL": {
      const months = period === "MONTHLY" ? 1 : period === "QUARTERLY" ? 3 : 12;
      const day = d.getUTCDate();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + months);
      const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(Math.min(day, lastDay));
      return d;
    }
  }
}

export type OrderLine = {
  type: OrderItemType;
  description: string;
  unitPrice: Prisma.Decimal | number;
  quantity?: number;
  membershipPlanId?: string;
  bookingId?: string;
  eventId?: string;
  eventRegistrationId?: string;
  serviceId?: string;
  servicePurchaseId?: string;
};

/** Computes tax from the configured rate. Inclusive prices keep the total unchanged. */
export async function computeTotals(subtotal: Prisma.Decimal) {
  const { taxRatePercent, taxInclusive } = await getSettings("payments");
  const rate = new Prisma.Decimal(taxRatePercent).div(100);
  if (rate.isZero()) return { subtotal, tax: new Prisma.Decimal(0), total: subtotal };
  if (taxInclusive) {
    const tax = subtotal.minus(subtotal.div(rate.plus(1))).toDecimalPlaces(2);
    return { subtotal: subtotal.minus(tax), tax, total: subtotal };
  }
  const tax = subtotal.mul(rate).toDecimalPlaces(2);
  return { subtotal, tax, total: subtotal.plus(tax) };
}

export async function createOrder(tx: Tx, input: { userId: string; currency: string; lines: OrderLine[]; expiresAt: Date }) {
  const lines = input.lines.map((line) => {
    const quantity = line.quantity ?? 1;
    const unitPrice = new Prisma.Decimal(line.unitPrice);
    return { ...line, quantity, unitPrice, total: unitPrice.mul(quantity) };
  });
  const gross = lines.reduce((sum, l) => sum.plus(l.total), new Prisma.Decimal(0));
  const totals = await computeTotals(gross);
  return tx.order.create({
    data: {
      number: await nextOrderNumber(tx),
      userId: input.userId,
      currency: input.currency,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      idempotencyKey: randomToken(16),
      expiresAt: input.expiresAt,
      items: {
        create: lines.map((l) => ({
          type: l.type,
          description: l.description,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          total: l.total,
          membershipPlanId: l.membershipPlanId,
          bookingId: l.bookingId,
          eventId: l.eventId,
          eventRegistrationId: l.eventRegistrationId,
          serviceId: l.serviceId,
          servicePurchaseId: l.servicePurchaseId,
        })),
      },
    },
  });
}

/** Releases holds attached to an order that will never be paid. */
export async function releaseOrderHolds(tx: Tx, orderId: string, reason: "EXPIRED" | "CANCELLED") {
  const items = await tx.orderItem.findMany({ where: { orderId, fulfilledAt: null } });
  for (const item of items) {
    if (item.bookingId) {
      const { count } = await tx.booking.updateMany({ where: { id: item.bookingId, status: "PENDING" }, data: { status: reason === "EXPIRED" ? "EXPIRED" : "CANCELLED", holdExpiresAt: null, cancelledAt: reason === "CANCELLED" ? new Date() : undefined } });
      if (count) await tx.bookingStatusHistory.create({ data: { bookingId: item.bookingId, status: reason === "EXPIRED" ? "EXPIRED" : "CANCELLED", note: reason === "EXPIRED" ? "Payment window lapsed" : "Order cancelled" } });
    }
    if (item.eventRegistrationId) {
      await tx.eventRegistration.updateMany({ where: { id: item.eventRegistrationId, status: "PENDING" }, data: { status: reason === "EXPIRED" ? "EXPIRED" : "CANCELLED", holdExpiresAt: null } });
    }
    if (item.servicePurchaseId) {
      await tx.servicePurchase.updateMany({ where: { id: item.servicePurchaseId, status: "PENDING" }, data: { status: reason === "EXPIRED" ? "EXPIRED" : "CANCELLED" } });
    }
  }
}
