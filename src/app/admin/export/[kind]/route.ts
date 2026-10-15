import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { currentUser } from "@/server/auth";
import { can, type Permission } from "@/server/rbac";
import { getSettings } from "@/server/settings";
import { bookingWhere, csv } from "@/server/admin/queries";
import { audit } from "@/server/audit";
import { formatDateTime } from "@/lib/format";
import { answerText, type StoredAnswer } from "@/lib/event-form";
import { rangeFrom, reconciliation, salesByProduct, shopOrderWhere, stockReport } from "@/server/shop/reports";

export const dynamic = "force-dynamic";

const PERMS: Record<string, Permission> = { bookings: "bookings.manage", registrations: "events.manage", payments: "reports.view", members: "reports.view", "shop-orders": "shop.orders", "shop-sales": "reports.view", "shop-inventory": "shop.inventory", "shop-reconciliation": "reports.view" };

/** Permission-checked CSV exports for reports. */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const user = await currentUser();
  const permission = PERMS[kind];
  if (!user || !permission || !(await can(user.role, permission))) return new NextResponse("Forbidden", { status: 403 });
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const { timezone } = await getSettings("general");
  let rows: (string | number | null)[][] = [];

  if (kind === "bookings") {
    const data = await prisma.booking.findMany({ where: bookingWhere(sp, timezone), include: { member: true, coach: { include: { user: true } }, sessionType: true }, orderBy: { startsAt: "asc" }, take: 20000 });
    rows = [["Reference", "Member", "Email", "Session", "Coach", "Starts", "Status", "Price", "Currency", "Included"], ...data.map((b) => [b.reference, b.member.name, b.member.email, b.sessionType.name, b.coach.user.name, formatDateTime(b.startsAt, timezone), b.status, b.price.toString(), b.currency, b.usedEntitlement ? "yes" : "no"])];
  } else if (kind === "registrations") {
    const data = await prisma.eventRegistration.findMany({ where: sp.event ? { eventId: sp.event } : {}, include: { user: true, event: true, items: { include: { session: true, package: true } } }, orderBy: { createdAt: "asc" }, take: 20000 });
    // Custom-form answers become extra columns; health & safety answers only with the sensitive permission.
    const sensitive = await can(user.role, "events.sensitive");
    const answerCols = new Map<string, string>();
    for (const r of data) for (const a of (r.answers ?? []) as StoredAnswer[]) if (!a.sensitive || sensitive) answerCols.set(a.key, a.label);
    const keys = [...answerCols.keys()];
    rows = [
      ["Reference", "Event", "Participant", "Contact", "Email", "Phone", "Status", "Fee", "Paid", "Fee status", "Sessions", "Registered", "Checked in", ...answerCols.values()],
      ...data.map((r) => {
        const answers = new Map(((r.answers ?? []) as StoredAnswer[]).map((a) => [a.key, a]));
        const sessions = [...r.items].sort((x, y) => x.session.position - y.session.position).map((i) => `${i.session.label}: ${i.package.name}${i.paidAt ? " (paid)" : ""}`).join(" | ");
        return [
          r.reference, r.event.title, r.participantName ?? r.user.name, r.contactName ?? r.user.name, r.contactEmail ?? r.user.email, r.contactPhone ?? r.user.phone, r.status, r.price.toString(), r.amountPaid.toString(), r.feeStatus, sessions,
          formatDateTime(r.createdAt, timezone), r.checkedInAt ? formatDateTime(r.checkedInAt, timezone) : "",
          ...keys.map((k) => { const a = answers.get(k); return a && (!a.sensitive || sensitive) ? answerText(a.value) : ""; }),
        ];
      }),
    ];
  } else if (kind === "payments") {
    const where = { ...(sp.status ? { status: sp.status as never } : {}), ...(sp.from ? { createdAt: { gte: new Date(sp.from) } } : {}) };
    const data = await prisma.payment.findMany({ where, include: { user: true, order: { include: { items: true } } }, orderBy: { createdAt: "asc" }, take: 50000 });
    rows = [["Created", "Order", "Member", "Phone", "Items", "Amount", "Currency", "Status", "M-Pesa receipt", "Completed"], ...data.map((p) => [formatDateTime(p.createdAt, timezone), p.order.number, p.user.name, p.phoneNumber, p.order.items.map((i) => i.description).join(" | "), p.amount.toString(), p.currency, p.status, p.receiptNumber, p.completedAt ? formatDateTime(p.completedAt, timezone) : ""])];
  } else if (kind === "shop-orders") {
    const data = await prisma.shopOrder.findMany({ where: shopOrderWhere(sp, timezone), include: { items: true, order: { include: { payments: { where: { status: { in: ["SUCCESS", "REFUNDED"] } }, take: 1 } } } }, orderBy: { createdAt: "asc" }, take: 50000 });
    rows = [
      ["Order", "Placed", "Status", "Customer", "Email", "Phone", "Items", "Subtotal", "Discount", "Code", "Delivery fee", "Total", "Method", "Option", "County", "Town", "Address", "M-Pesa receipt", "Paid", "Dispatched / ready", "Completed", "Courier", "Tracking", "Refund ref"],
      ...data.map((o) => [
        o.number, formatDateTime(o.createdAt, timezone), o.status, o.customerName, o.customerEmail, o.customerPhone,
        o.items.map((i) => `${i.quantity} x ${i.productName}${i.variantName ? ` (${i.variantName})` : ""} [${i.sku}]`).join(" | "),
        o.subtotal.toString(), o.discountTotal.toString(), o.discountCode, o.deliveryFee.toString(), o.total.toString(), o.fulfillmentMethod, o.deliveryOptionName, o.county, o.town, o.address,
        o.order.payments[0]?.receiptNumber ?? "", o.paidAt ? formatDateTime(o.paidAt, timezone) : "", (o.shippedAt ?? o.readyAt) ? formatDateTime((o.shippedAt ?? o.readyAt)!, timezone) : "", o.deliveredAt ? formatDateTime(o.deliveredAt, timezone) : "", o.courier, o.trackingNumber, o.refundReference,
      ]),
    ];
  } else if (kind === "shop-sales") {
    const data = await salesByProduct(await rangeFrom(sp), 10000);
    rows = [["Product", "Category", "Units sold", "Orders", "Revenue"], ...data.map((p) => [p.name, p.category, Number(p.quantity), Number(p.orders), p.revenue.toString()])];
  } else if (kind === "shop-inventory") {
    const data = await stockReport(sp.filter === "low" || sp.filter === "out" ? sp.filter : "all");
    rows = [["Product", "Variant", "SKU", "Product status", "On hand", "Reserved", "Available", "Alert at", "State", "Variant active"], ...data.map((r) => [r.product, r.variant, r.sku, r.status, r.onHand, r.reserved, r.available, r.threshold, r.state, r.active ? "yes" : "no"])];
  } else if (kind === "shop-reconciliation") {
    const data = await reconciliation(await rangeFrom(sp));
    rows = [["Order", "Customer", "Status", "Order total", "M-Pesa amount", "Receipt", "Phone", "Paid", "Attempts", "Refund ref", "Issues"], ...data.rows.map((r) => [r.number, r.customer, r.status, r.total, r.amount, r.receipt, r.phone, r.paidAt ? formatDateTime(r.paidAt, timezone) : "", r.attempts, r.refundReference, r.issues.join("; ")])];
  } else if (kind === "members") {
    const data = await prisma.user.findMany({ where: { deletedAt: null }, include: { memberships: { include: { plan: true }, orderBy: { expiresAt: "desc" }, take: 1 } }, orderBy: { createdAt: "asc" } });
    rows = [["Name", "Email", "Phone", "Role", "Joined", "Latest plan", "Membership status", "Expires"], ...data.map((u) => [u.name, u.email, u.phone, u.role, formatDateTime(u.createdAt, timezone), u.memberships[0]?.plan.name ?? "", u.memberships[0]?.status ?? "", u.memberships[0]?.expiresAt ? formatDateTime(u.memberships[0].expiresAt, timezone) : ""])];
  }

  await audit({ actorId: user.id, action: "report.export", entity: kind, next: { filters: sp, rows: rows.length - 1 } });
  return new NextResponse(`﻿${csv(rows)}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${kind}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}
