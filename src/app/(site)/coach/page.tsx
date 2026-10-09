import Link from "next/link";
import { CalendarClock, ClipboardCheck, Users, CalendarDays } from "lucide-react";
import { prisma } from "@/server/db";
import { requireCoach, coachMemberIds } from "@/server/coach";
import { getSettings } from "@/server/settings";
import { PageHeader, Stat } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { SessionControls } from "@/components/coach/coach-ui";
import { dateKeyInZone, addDaysToKey, zonedTimeToUtc } from "@/lib/time";
import { formatDateTime, formatTime } from "@/lib/format";

export default async function CoachHome() {
  const { user, coach } = await requireCoach();
  const { timezone } = await getSettings("general");
  const today = dateKeyInZone(new Date(), timezone);
  const start = zonedTimeToUtc(today, "00:00", timezone);
  const end = zonedTimeToUtc(addDaysToKey(today, 1), "00:00", timezone);
  const now = new Date();
  const [todays, upcoming, pending, memberIds, weekCount] = await Promise.all([
    prisma.booking.findMany({ where: { coachId: coach.id, startsAt: { gte: start, lt: end }, status: { in: ["CONFIRMED", "COMPLETED", "NO_SHOW"] } }, include: { member: { select: { name: true } }, sessionType: true }, orderBy: { startsAt: "asc" } }),
    prisma.booking.findMany({ where: { coachId: coach.id, startsAt: { gte: end }, status: "CONFIRMED" }, include: { member: { select: { name: true } }, sessionType: true }, orderBy: { startsAt: "asc" }, take: 8 }),
    prisma.learningAssignment.findMany({ where: { coachId: coach.id, status: "SUBMITTED" }, include: { member: { select: { name: true } } }, orderBy: { submittedAt: "asc" }, take: 6 }),
    coachMemberIds(coach.id),
    prisma.booking.count({ where: { coachId: coach.id, status: "CONFIRMED", startsAt: { gte: now, lt: new Date(now.getTime() + 7 * 86400_000) } } }),
  ]);
  return (
    <div className="grid gap-6">
      <PageHeader eyebrow="Coach workspace" title={`Good to see you, ${user.name.split(" ")[0]}.`} />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Sessions today" value={todays.length} icon={<CalendarClock />} />
        <Stat label="Next 7 days" value={weekCount} icon={<CalendarDays />} />
        <Stat label="Pending reviews" value={pending.length} icon={<ClipboardCheck />} />
        <Stat label="Members coached" value={memberIds.length} icon={<Users />} />
      </div>
      <Card>
        <CardHeader><CardTitle>Today</CardTitle><Link href="/coach/sessions" className="text-sm text-brand-ink">All sessions</Link></CardHeader>
        <CardContent className="grid gap-3">
          {todays.length ? todays.map((b) => (
            <div key={b.id} className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2"><span className="font-mono text-brand-ink">{formatTime(b.startsAt, timezone)}</span><span className="font-semibold">{b.member.name}</span><StatusBadge status={b.status} /></div>
                <div className="text-sm text-muted">{b.sessionType.name}{b.memberNotes ? ` · “${b.memberNotes}”` : ""}</div>
              </div>
              <SessionControls bookingId={b.id} status={b.status} notes={b.coachNotes} started={b.startsAt <= now} />
            </div>
          )) : <p className="text-sm text-muted">No sessions today.</p>}
        </CardContent>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Upcoming bookings</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            {upcoming.length ? upcoming.map((b) => (
              <div key={b.id} className="flex justify-between gap-3 rounded-xl p-2 text-sm"><span>{b.member.name} · {b.sessionType.name}</span><span className="text-muted">{formatDateTime(b.startsAt, timezone)}</span></div>
            )) : <p className="text-sm text-muted">Nothing booked yet. Make sure your <Link href="/coach/availability" className="text-brand-ink">availability</Link> is set.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Waiting for your review</CardTitle><Link href="/coach/assignments" className="text-sm text-brand-ink">Review</Link></CardHeader>
          <CardContent className="grid gap-2">
            {pending.length ? pending.map((a) => <div key={a.id} className="flex justify-between gap-3 text-sm"><span>{a.title}</span><span className="text-muted">{a.member.name}</span></div>) : <p className="text-sm text-muted">All submissions reviewed.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
