import Link from "next/link";
import { ArrowRight, BookOpen, CalendarCheck, CalendarDays, ClipboardList, Crown, Flame, MessagesSquare, Trophy } from "lucide-react";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getAllSettings } from "@/server/settings";
import { activeMemberships } from "@/server/memberships";
import { learningSummary } from "@/server/learning";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { formatDate, formatDateTime, relativeTime } from "@/lib/format";

export default async function DashboardPage() {
  const user = await requireUser("/dashboard");
  const settings = await getAllSettings();
  const tz = settings.general.timezone;
  const now = new Date();
  const [memberships, bookings, registrations, learning, profile, solved, attempts, assignments, notifications, myPosts, myComments, pendingOrders] = await Promise.all([
    activeMemberships(user.id),
    prisma.booking.findMany({ where: { memberId: user.id, startsAt: { gte: now }, status: { in: ["CONFIRMED", "PENDING"] } }, include: { sessionType: true, coach: { include: { user: { select: { name: true } } } } }, orderBy: { startsAt: "asc" }, take: 4 }),
    prisma.eventRegistration.findMany({ where: { userId: user.id, status: { in: ["CONFIRMED", "PENDING"] }, event: { startsAt: { gte: now } } }, include: { event: true }, orderBy: { event: { startsAt: "asc" } }, take: 4 }),
    learningSummary(user.id),
    prisma.memberProfile.findUnique({ where: { userId: user.id } }),
    prisma.puzzleAttempt.findMany({ where: { userId: user.id, solved: true }, distinct: ["puzzleId"], select: { puzzleId: true } }),
    prisma.puzzleAttempt.count({ where: { userId: user.id } }),
    prisma.learningAssignment.findMany({ where: { memberId: user.id, status: { in: ["ASSIGNED", "SUBMITTED"] } }, include: { coach: { include: { user: { select: { name: true } } } } }, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 4 }),
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.communityPost.count({ where: { authorId: user.id, status: "VISIBLE" } }),
    prisma.communityComment.count({ where: { authorId: user.id, status: "VISIBLE" } }),
    prisma.order.findMany({ where: { userId: user.id, status: "PENDING", expiresAt: { gt: now } }, orderBy: { createdAt: "desc" }, take: 3 }),
  ]);
  const membership = memberships[0];
  const daysLeft = membership?.expiresAt ? Math.max(0, Math.ceil((membership.expiresAt.getTime() - now.getTime()) / 86400_000)) : 0;

  return (
    <div className="grid gap-6">
      <div>
        <div className="eyebrow">Dashboard</div>
        <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Hi, {user.name.split(" ")[0]}.</h1>
      </div>

      {pendingOrders.length > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm">You have {pendingOrders.length} unpaid {pendingOrders.length === 1 ? "order" : "orders"} waiting for payment.</span>
          <Button asChild size="sm"><Link href={`/pay/${pendingOrders[0].id}`}>Complete payment</Link></Button>
        </div>
      )}

      <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-brand/15 via-surface to-surface p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-6 -top-10 font-display text-[180px] leading-none text-brand-ink/10">♛</div>
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted"><Crown className="size-4 text-brand-ink" />Membership</div>
            {membership ? (
              <>
                <div className="mt-2 font-display text-3xl font-extrabold tracking-tight">{membership.plan.name}</div>
                <div className="mt-1 text-muted">Active until {formatDate(membership.expiresAt!, tz)} · <span className="text-foreground">{daysLeft} {daysLeft === 1 ? "day" : "days"} left</span></div>
                {memberships.length > 1 && <div className="mt-1 text-xs text-muted">+ {memberships.length - 1} other active plan{memberships.length > 2 ? "s" : ""}</div>}
              </>
            ) : (
              <>
                <div className="mt-2 font-display text-3xl font-extrabold tracking-tight">No active membership</div>
                <div className="mt-1 text-muted">Choose a plan to play daily and unlock coaching benefits.</div>
              </>
            )}
          </div>
          <div className="flex gap-2">
            {membership ? <Button asChild variant="secondary"><Link href={`/join/${membership.plan.slug}`}>Renew</Link></Button> : <Button asChild><Link href="/memberships">See memberships</Link></Button>}
            <Button asChild><Link href="/book"><CalendarCheck />Book</Link></Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Lessons completed" value={learning.completed} hint={`${learning.inProgress} in progress · ${learning.total} available`} icon={<BookOpen />} />
        <Stat label="Puzzle rating" value={profile?.puzzleRating ?? 0} hint={`${solved.length} solved · ${attempts} attempts`} icon={<Trophy />} />
        <Stat label="Puzzle streak" value={profile?.puzzleStreak ?? 0} hint={`Best ${profile?.puzzleBestStreak ?? 0}`} icon={<Flame />} />
        <Stat label="Community" value={myPosts + myComments} hint={`${myPosts} posts · ${myComments} replies`} icon={<MessagesSquare />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Upcoming sessions</CardTitle><Link href="/dashboard/bookings" className="text-sm text-brand-ink">All</Link></CardHeader>
          <CardContent className="grid gap-3">
            {bookings.length ? bookings.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 p-4">
                <div><div className="font-semibold">{b.sessionType.name}</div><div className="text-sm text-muted">{formatDateTime(b.startsAt, tz)} · {b.coach.user.name}</div></div>
                <StatusBadge status={b.status} />
              </div>
            )) : <Empty text="No upcoming sessions." cta={{ href: "/book", label: "Book a session" }} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Upcoming events</CardTitle><Link href="/dashboard/events" className="text-sm text-brand-ink">All</Link></CardHeader>
          <CardContent className="grid gap-3">
            {registrations.length ? registrations.map((r) => (
              <Link key={r.id} href={`/events/${r.event.slug}`} className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 p-4 hover:bg-surface-3">
                <div><div className="font-semibold">{r.event.title}</div><div className="text-sm text-muted">{formatDateTime(r.event.startsAt, tz)}</div></div>
                <StatusBadge status={r.status} />
              </Link>
            )) : <Empty text="You're not registered for any events." cta={{ href: "/events", label: "Browse events" }} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="size-4 text-brand-ink" />Coaching tasks</CardTitle><Link href="/dashboard/assignments" className="text-sm text-brand-ink">All</Link></CardHeader>
          <CardContent className="grid gap-3">
            {assignments.length ? assignments.map((a) => (
              <Link key={a.id} href="/dashboard/assignments" className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 p-4 hover:bg-surface-3">
                <div><div className="font-semibold">{a.title}</div><div className="text-sm text-muted">From {a.coach.user.name}{a.dueAt ? ` · due ${formatDate(a.dueAt, tz)}` : ""}</div></div>
                <StatusBadge status={a.status} />
              </Link>
            )) : <Empty text="No assigned work right now." />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Notifications</CardTitle><Link href="/dashboard/notifications" className="text-sm text-brand-ink">All</Link></CardHeader>
          <CardContent className="grid gap-1">
            {notifications.length ? notifications.map((n) => (
              <Link key={n.id} href={n.link ?? "/dashboard/notifications"} className="flex items-start gap-3 rounded-xl p-3 hover:bg-foreground/[0.03]">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-surface-3" : "bg-brand"}`} />
                <div className="min-w-0"><div className="truncate text-sm font-semibold">{n.title}</div><div className="truncate text-xs text-muted">{n.body}</div></div>
                <span className="ml-auto shrink-0 text-xs text-muted">{relativeTime(n.createdAt)}</span>
              </Link>
            )) : <Empty text="No notifications yet." />}
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary"><Link href="/learn"><BookOpen />Continue learning</Link></Button>
        <Button asChild variant="secondary"><Link href="/puzzles"><Trophy />Solve puzzles</Link></Button>
        <Button asChild variant="secondary"><Link href="/community"><MessagesSquare />Community</Link></Button>
        <Button asChild variant="secondary"><Link href="/events"><CalendarDays />Events</Link></Button>
      </div>
    </div>
  );
}

function Empty({ text, cta }: { text: string; cta?: { href: string; label: string } }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border p-5 text-sm text-muted">
      {text}
      {cta && <Link href={cta.href} className="inline-flex items-center gap-1.5 font-semibold text-brand-ink">{cta.label}<ArrowRight className="size-4" /></Link>}
    </div>
  );
}
