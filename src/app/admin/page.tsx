import Link from "next/link";
import { Activity, AlertTriangle, BookOpen, CalendarCheck, CalendarDays, CheckCircle2, Crown, Hourglass, MessagesSquare, UserX, Users, Wallet } from "lucide-react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { can } from "@/server/rbac";
import { navFor } from "@/server/admin/nav";
import { getAllSettings } from "@/server/settings";
import { activeMembershipWhere } from "@/server/memberships";
import { activeProvider } from "@/server/payments/registry";
import { PageHeader, Stat, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { RevenueChart } from "@/components/admin/revenue-chart";
import { addDaysToKey, dateKeyInZone, zonedTimeToUtc } from "@/lib/time";
import { formatDate, formatDateTime, formatMoney, formatNumber, humanize } from "@/lib/format";

export const metadata = { title: "Dashboard" };

export default async function AdminDashboard() {
  const user = await requireUser("/admin");
  if (!(await can(user.role, "dashboard.view"))) {
    // Roles without the dashboard land on their first permitted module.
    const first = (await navFor(user.role))[0]?.items[0]?.href;
    redirect(first && first !== "/admin" ? first : "/forbidden");
  }
  const settings = await getAllSettings();
  const tz = settings.general.timezone;
  const currency = settings.general.currency;
  const now = new Date();
  const today = dateKeyInZone(now, tz);
  const dayStart = zonedTimeToUtc(today, "00:00", tz);
  const dayEnd = zonedTimeToUtc(addDaysToKey(today, 1), "00:00", tz);
  const monthStart = zonedTimeToUtc(`${today.slice(0, 7)}-01`, "00:00", tz);
  const since30 = zonedTimeToUtc(addDaysToKey(today, -29), "00:00", tz);

  const [members, activeMemberships, expiredMemberships, revenueAll, revenueMonth, pendingPayments, successfulPayments, failedPayments, todaysBookings, upcomingEvents, learningActivity, posts, comments, openReports, recentPayments, daily, byType, provider] = await Promise.all([
    prisma.user.count({ where: { role: "MEMBER", deletedAt: null } }),
    prisma.membership.count({ where: activeMembershipWhere(now) }),
    prisma.membership.count({ where: { OR: [{ status: "EXPIRED" }, { status: "ACTIVE", expiresAt: { lte: now } }] } }),
    prisma.payment.aggregate({ where: { status: "SUCCESS" }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { status: "SUCCESS", completedAt: { gte: monthStart } }, _sum: { amount: true } }),
    prisma.payment.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
    prisma.payment.count({ where: { status: "SUCCESS" } }),
    prisma.payment.count({ where: { status: { in: ["FAILED", "CANCELLED"] }, createdAt: { gte: since30 } } }),
    prisma.booking.count({ where: { startsAt: { gte: dayStart, lt: dayEnd }, status: { in: ["CONFIRMED", "COMPLETED", "NO_SHOW"] } } }),
    prisma.event.count({ where: { status: "PUBLISHED", deletedAt: null, startsAt: { gte: now } } }),
    prisma.learningProgress.count({ where: { updatedAt: { gte: since30 } } }),
    prisma.communityPost.count({ where: { createdAt: { gte: since30 } } }),
    prisma.communityComment.count({ where: { createdAt: { gte: since30 } } }),
    prisma.communityReport.count({ where: { status: "OPEN" } }),
    prisma.payment.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { user: { select: { name: true } }, order: { select: { number: true } } } }),
    prisma.$queryRaw<{ day: string; total: Prisma.Decimal }[]>`
      SELECT to_char(("completedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, SUM("amount") AS total
      FROM "Payment" WHERE "status" = 'SUCCESS' AND "completedAt" >= ${since30}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ type: string; total: Prisma.Decimal; count: bigint }[]>`
      SELECT oi."type"::text AS type, SUM(oi."total") AS total, COUNT(*) AS count
      FROM "OrderItem" oi JOIN "Order" o ON o."id" = oi."orderId"
      WHERE o."status" = 'PAID' AND o."paidAt" >= ${since30}
      GROUP BY 1 ORDER BY 2 DESC`,
    activeProvider(),
  ]);
  const readiness = provider ? await provider.impl.readiness() : null;
  const byDay = new Map(daily.map((d) => [d.day, Number(d.total)]));
  const points = Array.from({ length: 30 }, (_, i) => {
    const key = addDaysToKey(today, i - 29);
    const amount = byDay.get(key) ?? 0;
    return { date: key, label: formatDate(new Date(`${key}T12:00:00Z`), "UTC", { day: "numeric", month: "short" }), amount, display: formatMoney(amount, currency) };
  });
  const total30 = points.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="grid gap-6">
      <PageHeader eyebrow="Overview" title="Club dashboard" description={`Live figures from the database · ${formatDateTime(now, tz)}`} />

      {(!provider || !readiness?.ready) && (
        <Link href="/admin/payment-settings" className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="size-5 shrink-0 text-warning" />
          <span><span className="font-semibold">M-Pesa is not accepting payments.</span> {provider ? `Missing: ${readiness?.missing.join(", ")}.` : "No payment provider is enabled."} Configure payment settings →</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total members" value={formatNumber(members)} icon={<Users />} />
        <Stat label="Active memberships" value={formatNumber(activeMemberships)} icon={<Crown />} />
        <Stat label="Expired memberships" value={formatNumber(expiredMemberships)} icon={<UserX />} />
        <Stat label="Revenue this month" value={formatMoney(revenueMonth._sum.amount ?? 0, currency)} hint={`All time ${formatMoney(revenueAll._sum.amount ?? 0, currency)}`} icon={<Wallet />} />
        <Stat label="Pending payments" value={formatNumber(pendingPayments)} icon={<Hourglass />} />
        <Stat label="Successful payments" value={formatNumber(successfulPayments)} hint={`${failedPayments} failed / cancelled in 30 days`} icon={<CheckCircle2 />} />
        <Stat label="Today's bookings" value={formatNumber(todaysBookings)} icon={<CalendarCheck />} />
        <Stat label="Upcoming events" value={formatNumber(upcomingEvents)} icon={<CalendarDays />} />
        <Stat label="Learning activity (30d)" value={formatNumber(learningActivity)} hint="Lessons started or completed" icon={<BookOpen />} />
        <Stat label="Community activity (30d)" value={formatNumber(posts + comments)} hint={`${posts} posts · ${comments} replies`} icon={<MessagesSquare />} />
        <Stat label="Open reports" value={formatNumber(openReports)} hint={openReports ? <Link href="/admin/moderation" className="text-brand">Review</Link> : "Nothing to review"} icon={<Activity />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardContent>
            <RevenueChart title={`Revenue, last 30 days · ${formatMoney(total30, currency)}`} points={points} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Paid in the last 30 days, by type</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {byType.length ? byType.map((t) => (
              <div key={t.type} className="flex items-center justify-between text-sm">
                <span>{humanize(t.type)} <span className="text-muted">· {Number(t.count)}</span></span>
                <span className="font-mono">{formatMoney(t.total, currency)}</span>
              </div>
            )) : <p className="text-sm text-muted">No paid orders in the last 30 days.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Recent payments</CardTitle><Link href="/admin/payments" className="text-sm text-brand">All payments</Link></CardHeader>
        <CardContent className="p-0">
          {recentPayments.length ? (
            <Table className="rounded-none border-0">
              <THead><tr><TH>Member</TH><TH>Order</TH><TH>Amount</TH><TH>Status</TH><TH>When</TH></tr></THead>
              <tbody>
                {recentPayments.map((p) => (
                  <TR key={p.id}>
                    <TD><Link href={`/admin/payments/${p.id}`} className="hover:text-brand">{p.user.name}</Link></TD>
                    <TD className="font-mono text-xs">{p.order.number}</TD>
                    <TD className="font-mono">{formatMoney(p.amount, p.currency)}</TD>
                    <TD><StatusBadge status={p.status} /></TD>
                    <TD className="text-muted">{formatDateTime(p.createdAt, tz)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          ) : <p className="p-5 text-sm text-muted">No payments yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
