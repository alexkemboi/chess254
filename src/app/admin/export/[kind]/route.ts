import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { currentUser } from "@/server/auth";
import { can, type Permission } from "@/server/rbac";
import { getSettings } from "@/server/settings";
import { bookingWhere, csv } from "@/server/admin/queries";
import { audit } from "@/server/audit";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const PERMS: Record<string, Permission> = { bookings: "bookings.manage", registrations: "events.manage", payments: "reports.view", members: "reports.view" };

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
    const data = await prisma.eventRegistration.findMany({ where: sp.event ? { eventId: sp.event } : {}, include: { user: true, event: true }, orderBy: { createdAt: "asc" }, take: 20000 });
    rows = [["Reference", "Event", "Name", "Email", "Phone", "Status", "Price", "Registered", "Checked in"], ...data.map((r) => [r.reference, r.event.title, r.user.name, r.user.email, r.user.phone, r.status, r.price.toString(), formatDateTime(r.createdAt, timezone), r.checkedInAt ? formatDateTime(r.checkedInAt, timezone) : ""])];
  } else if (kind === "payments") {
    const where = { ...(sp.status ? { status: sp.status as never } : {}), ...(sp.from ? { createdAt: { gte: new Date(sp.from) } } : {}) };
    const data = await prisma.payment.findMany({ where, include: { user: true, order: { include: { items: true } } }, orderBy: { createdAt: "asc" }, take: 50000 });
    rows = [["Created", "Order", "Member", "Phone", "Items", "Amount", "Currency", "Status", "M-Pesa receipt", "Completed"], ...data.map((p) => [formatDateTime(p.createdAt, timezone), p.order.number, p.user.name, p.phoneNumber, p.order.items.map((i) => i.description).join(" | "), p.amount.toString(), p.currency, p.status, p.receiptNumber, p.completedAt ? formatDateTime(p.completedAt, timezone) : ""])];
  } else if (kind === "members") {
    const data = await prisma.user.findMany({ where: { deletedAt: null }, include: { memberships: { include: { plan: true }, orderBy: { expiresAt: "desc" }, take: 1 } }, orderBy: { createdAt: "asc" } });
    rows = [["Name", "Email", "Phone", "Role", "Joined", "Latest plan", "Membership status", "Expires"], ...data.map((u) => [u.name, u.email, u.phone, u.role, formatDateTime(u.createdAt, timezone), u.memberships[0]?.plan.name ?? "", u.memberships[0]?.status ?? "", u.memberships[0]?.expiresAt ? formatDateTime(u.memberships[0].expiresAt, timezone) : ""])];
  }

  await audit({ actorId: user.id, action: "report.export", entity: kind, next: { filters: sp, rows: rows.length - 1 } });
  return new NextResponse(`﻿${csv(rows)}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${kind}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}
