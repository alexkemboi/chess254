import Link from "next/link";
import { CalendarClock } from "lucide-react";
import type { BookingStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { requireCoach } from "@/server/coach";
import { getSettings } from "@/server/settings";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/badge";
import { SessionControls } from "@/components/coach/coach-ui";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const TABS = { upcoming: "Upcoming", past: "Past", cancelled: "Cancelled" } as const;

export default async function CoachSessions({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { coach } = await requireCoach();
  const { timezone } = await getSettings("general");
  const tab = ((await searchParams).tab ?? "upcoming") as keyof typeof TABS;
  const now = new Date();
  const where =
    tab === "cancelled" ? { status: { in: ["CANCELLED", "EXPIRED"] as BookingStatus[] } } :
    tab === "past" ? { startsAt: { lt: now }, status: { in: ["CONFIRMED", "COMPLETED", "NO_SHOW"] as BookingStatus[] } } :
    { startsAt: { gte: now }, status: { in: ["CONFIRMED", "PENDING"] as BookingStatus[] } };
  const bookings = await prisma.booking.findMany({ where: { coachId: coach.id, ...where }, include: { member: { select: { name: true, email: true, phone: true } }, sessionType: true }, orderBy: { startsAt: tab === "upcoming" ? "asc" : "desc" }, take: 100 });
  return (
    <div>
      <PageHeader eyebrow="Sessions" title="Your sessions" />
      <div className="mb-5 flex gap-2">
        {Object.entries(TABS).map(([k, label]) => <Link key={k} href={`/coach/sessions?tab=${k}`} className={cn("rounded-full border px-4 py-2 text-sm", tab === k ? "border-brand bg-brand text-black" : "border-border text-muted")}>{label}</Link>)}
      </div>
      {bookings.length === 0 ? (
        <EmptyState icon={<CalendarClock />} title="No sessions" />
      ) : (
        <ul className="grid gap-3">
          {bookings.map((b) => (
            <li key={b.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{b.member.name}</span><StatusBadge status={b.status} /></div>
                <div className="text-sm text-muted">{b.sessionType.name} · {formatDateTime(b.startsAt, timezone)} · <span className="font-mono">{b.reference}</span></div>
                {b.memberNotes && <div className="mt-1 text-sm">“{b.memberNotes}”</div>}
                {b.coachNotes && <div className="mt-1 text-xs text-muted">Your notes: {b.coachNotes}</div>}
              </div>
              {tab !== "cancelled" && b.status !== "PENDING" && <SessionControls bookingId={b.id} status={b.status} notes={b.coachNotes} started={b.startsAt <= now} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
