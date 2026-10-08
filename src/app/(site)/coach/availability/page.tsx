import { prisma } from "@/server/db";
import { requireCoach } from "@/server/coach";
import { getSettings } from "@/server/settings";
import { primaryLocation } from "@/server/content";
import { PageHeader } from "@/components/ui/misc";
import { AvailabilityEditor, RemoveTimeOff, TimeOffForm } from "@/components/coach/coach-ui";
import { formatDateTime } from "@/lib/format";

export default async function AvailabilityPage() {
  const { coach } = await requireCoach();
  const { timezone } = await getSettings("general");
  const [availability, timeOff, location] = await Promise.all([
    prisma.coachAvailability.findMany({ where: { coachId: coach.id }, orderBy: [{ weekday: "asc" }, { startTime: "asc" }] }),
    prisma.coachTimeOff.findMany({ where: { coachId: coach.id, endsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } }),
    primaryLocation(),
  ]);
  return (
    <div className="grid gap-10">
      <div>
        <PageHeader eyebrow="Availability" title="Weekly hours" description="Members can book you inside these windows, within clubhouse opening hours. Changes apply to the booking calendar immediately." />
        <AvailabilityEditor initial={availability.map((a) => ({ weekday: a.weekday, startTime: a.startTime, endTime: a.endTime }))} hours={location?.openingHours ?? []} />
      </div>
      <section>
        <h2 className="mb-4 font-display text-2xl font-bold tracking-tight">Block dates & unavailable periods</h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-border bg-surface p-6"><TimeOffForm /></div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <h3 className="mb-3 font-semibold">Upcoming blocks</h3>
            {timeOff.length ? (
              <ul className="grid gap-2">
                {timeOff.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 p-3 text-sm">
                    <div><div>{formatDateTime(t.startsAt, timezone)} → {formatDateTime(t.endsAt, timezone)}</div>{t.reason && <div className="text-xs text-muted">{t.reason}</div>}</div>
                    <RemoveTimeOff id={t.id} />
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No blocked periods.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
