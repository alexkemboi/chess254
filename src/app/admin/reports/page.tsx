import { Download } from "lucide-react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { getAllSettings } from "@/server/settings";
import { PageHeader, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoney, humanize } from "@/lib/format";

export const metadata = { title: "Reports" };

export default async function Reports() {
  await requirePermission("reports.view", "/admin/reports");
  const settings = await getAllSettings();
  const tz = settings.general.timezone;
  const currency = settings.general.currency;
  const [monthly, byPlan, byCoach, events] = await Promise.all([
    prisma.$queryRaw<{ month: string; type: string; total: Prisma.Decimal; orders: bigint }[]>`
      SELECT to_char((o."paidAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM') AS month, oi."type"::text AS type, SUM(oi."total") AS total, COUNT(DISTINCT o."id") AS orders
      FROM "Order" o JOIN "OrderItem" oi ON oi."orderId" = o."id"
      WHERE o."status" = 'PAID' AND o."paidAt" >= now() - interval '12 months'
      GROUP BY 1, 2 ORDER BY 1 DESC, 2`,
    prisma.$queryRaw<{ name: string; active: bigint; total: bigint }[]>`
      SELECT p."name", COUNT(m."id") FILTER (WHERE m."status" = 'ACTIVE' AND m."expiresAt" > now()) AS active, COUNT(m."id") AS total
      FROM "MembershipPlan" p LEFT JOIN "Membership" m ON m."planId" = p."id"
      GROUP BY p."id", p."name", p."priority" ORDER BY p."priority"`,
    prisma.$queryRaw<{ name: string; completed: bigint; upcoming: bigint; noshow: bigint; cancelled: bigint }[]>`
      SELECT u."name", COUNT(b."id") FILTER (WHERE b."status" = 'COMPLETED') AS completed,
        COUNT(b."id") FILTER (WHERE b."status" = 'CONFIRMED' AND b."startsAt" > now()) AS upcoming,
        COUNT(b."id") FILTER (WHERE b."status" = 'NO_SHOW') AS noshow,
        COUNT(b."id") FILTER (WHERE b."status" = 'CANCELLED') AS cancelled
      FROM "CoachProfile" c JOIN "User" u ON u."id" = c."userId" LEFT JOIN "Booking" b ON b."coachId" = c."id"
      GROUP BY u."name" ORDER BY u."name"`,
    prisma.event.findMany({ where: { deletedAt: null }, orderBy: { startsAt: "desc" }, take: 12, include: { _count: { select: { registrations: { where: { status: { in: ["CONFIRMED", "ATTENDED"] } } } } } } }),
  ]);
  const months = [...new Set(monthly.map((m) => m.month))];
  const types = [...new Set(monthly.map((m) => m.type))];
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Reports"
        description="Revenue, memberships, coaching and events — straight from the database."
        actions={
          <>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download from a route handler */}
            <Button asChild variant="secondary" size="sm"><a href="/admin/export/payments"><Download />Payments CSV</a></Button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download from a route handler */}
            <Button asChild variant="secondary" size="sm"><a href="/admin/export/members"><Download />Members CSV</a></Button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download from a route handler */}
            <Button asChild variant="secondary" size="sm"><a href="/admin/export/bookings"><Download />Bookings CSV</a></Button>
          </>
        }
      />
      <Card>
        <CardHeader><CardTitle>Paid revenue by month (last 12 months)</CardTitle></CardHeader>
        <CardContent className="p-0">
          {months.length ? (
            <Table className="rounded-none border-0">
              <THead><tr><TH>Month</TH>{types.map((t) => <TH key={t} className="text-right">{humanize(t)}</TH>)}<TH className="text-right">Total</TH></tr></THead>
              <tbody>
                {months.map((m) => {
                  const rows = monthly.filter((r) => r.month === m);
                  const sum = rows.reduce((s, r) => s + Number(r.total), 0);
                  return (
                    <TR key={m}>
                      <TD className="font-mono">{m}</TD>
                      {types.map((t) => <TD key={t} className="text-right font-mono">{formatMoney(Number(rows.find((r) => r.type === t)?.total ?? 0), currency)}</TD>)}
                      <TD className="text-right font-mono font-semibold">{formatMoney(sum, currency)}</TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          ) : <p className="p-5 text-sm text-muted">No paid orders yet.</p>}
        </CardContent>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Memberships by plan</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table className="rounded-none border-0">
              <THead><tr><TH>Plan</TH><TH className="text-right">Active</TH><TH className="text-right">All time</TH></tr></THead>
              <tbody>{byPlan.map((p) => <TR key={p.name}><TD>{p.name}</TD><TD className="text-right">{Number(p.active)}</TD><TD className="text-right">{Number(p.total)}</TD></TR>)}</tbody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Bookings by coach</CardTitle></CardHeader>
          <CardContent className="p-0">
            {byCoach.length ? (
              <Table className="rounded-none border-0">
                <THead><tr><TH>Coach</TH><TH className="text-right">Upcoming</TH><TH className="text-right">Completed</TH><TH className="text-right">No-show</TH><TH className="text-right">Cancelled</TH></tr></THead>
                <tbody>{byCoach.map((c) => <TR key={c.name}><TD>{c.name}</TD><TD className="text-right">{Number(c.upcoming)}</TD><TD className="text-right">{Number(c.completed)}</TD><TD className="text-right">{Number(c.noshow)}</TD><TD className="text-right">{Number(c.cancelled)}</TD></TR>)}</tbody>
              </Table>
            ) : <p className="p-5 text-sm text-muted">No coaches yet.</p>}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Events</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table className="rounded-none border-0">
            <THead><tr><TH>Event</TH><TH>Status</TH><TH className="text-right">Registered</TH><TH className="text-right">Capacity</TH><TH /></tr></THead>
            <tbody>{events.map((e) => <TR key={e.id}><TD>{e.title}</TD><TD>{humanize(e.status)}</TD><TD className="text-right">{e._count.registrations}</TD><TD className="text-right">{e.capacity ?? "∞"}</TD><TD className="text-right"><a href={`/admin/export/registrations?event=${e.id}`} className="text-xs text-brand-ink">CSV</a></TD></TR>)}</tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
