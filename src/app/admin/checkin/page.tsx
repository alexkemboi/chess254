import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { addDaysToKey, dateKeyInZone, zonedTimeToUtc } from "@/lib/time";
import { PageHeader, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/badge";
import { CheckInForm } from "@/components/admin/checkin-form";
import { formatTime } from "@/lib/format";

export const metadata = { title: "Front desk" };

export default async function CheckInPage() {
  await requirePermission("bookings.manage", "/admin/checkin");
  const { timezone } = await getSettings("general");
  const today = dateKeyInZone(new Date(), timezone);
  const start = zonedTimeToUtc(today, "00:00", timezone);
  const end = zonedTimeToUtc(addDaysToKey(today, 1), "00:00", timezone);
  const [bookings, passes] = await Promise.all([
    prisma.booking.findMany({ where: { startsAt: { gte: start, lt: end }, status: { in: ["CONFIRMED", "COMPLETED", "NO_SHOW"] } }, include: { member: true, sessionType: true, coach: { include: { user: { select: { name: true } } } } }, orderBy: { startsAt: "asc" } }),
    prisma.servicePurchase.findMany({ where: { status: { in: ["ACTIVE", "REDEEMED"] }, validUntil: { gte: start } }, include: { service: true, user: true }, orderBy: { validFrom: "desc" }, take: 50 }),
  ]);
  return (
    <div className="grid gap-8">
      <PageHeader title="Front desk" description="Redeem day passes and check in event players by code." />
      <div className="max-w-xl rounded-2xl border border-border bg-surface p-6"><CheckInForm /></div>
      <section>
        <h2 className="mb-3 font-semibold">Today’s sessions ({bookings.length})</h2>
        {bookings.length ? (
          <Table>
            <THead><tr><TH>Time</TH><TH>Member</TH><TH>Session</TH><TH>Coach</TH><TH>Status</TH></tr></THead>
            <tbody>{bookings.map((b) => <TR key={b.id}><TD className="font-mono">{formatTime(b.startsAt, timezone)}</TD><TD>{b.member.name}</TD><TD>{b.sessionType.name}</TD><TD>{b.coach.user.name}</TD><TD><StatusBadge status={b.status} /></TD></TR>)}</tbody>
          </Table>
        ) : <p className="text-sm text-muted">No sessions today.</p>}
      </section>
      <section>
        <h2 className="mb-3 font-semibold">Passes valid today</h2>
        {passes.length ? (
          <Table>
            <THead><tr><TH>Code</TH><TH>Member</TH><TH>Pass</TH><TH>Status</TH></tr></THead>
            <tbody>{passes.map((p) => <TR key={p.id}><TD className="font-mono">{p.code}</TD><TD>{p.user.name}</TD><TD>{p.service.name}</TD><TD><StatusBadge status={p.status} /></TD></TR>)}</tbody>
          </Table>
        ) : <p className="text-sm text-muted">No passes for today.</p>}
      </section>
    </div>
  );
}
