import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import type { EventType, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { getAllSettings } from "@/server/settings";
import { seoFor } from "@/server/content";
import { seatsTaken } from "@/server/events";
import { Container, EventCard, PageHero } from "@/components/site/cards";
import { Reveal } from "@/components/site/reveal";
import { EmptyState } from "@/components/ui/misc";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

const TYPES: EventType[] = ["TOURNAMENT", "RAPID_TOURNAMENT", "BLITZ_TOURNAMENT", "TRAINING_CAMP", "HANGOUT", "KIDS_SESSION", "EXHIBITION", "COMMUNITY"];

export async function generateMetadata(): Promise<Metadata> {
  const seo = await seoFor("/events");
  return { title: seo?.title ?? "Events & tournaments", description: seo?.description ?? "Tournaments, hangouts, training camps and community events.", alternates: { canonical: "/events" } };
}

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ type?: string; when?: string; q?: string }> }) {
  const sp = await searchParams;
  const settings = await getAllSettings();
  const when = sp.when === "past" && settings.events.showPastEvents ? "past" : "upcoming";
  const type = TYPES.includes(sp.type as EventType) ? (sp.type as EventType) : undefined;
  const q = sp.q?.trim().slice(0, 80);
  const now = new Date();
  const where: Prisma.EventWhereInput = {
    deletedAt: null,
    status: when === "past" ? { in: ["PUBLISHED", "COMPLETED"] } : "PUBLISHED",
    ...(when === "past" ? { endsAt: { lt: now } } : { endsAt: { gte: now } }),
    ...(type ? { type } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const events = await prisma.event.findMany({ where, include: { location: true }, orderBy: { startsAt: when === "past" ? "desc" : "asc" }, take: 60 });
  const seats = await Promise.all(events.map(async (e) => (e.capacity === null || when === "past" ? null : Math.max(0, e.capacity - (await seatsTaken(e.id))))));
  const link = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams(Object.entries({ type, when: when === "past" ? "past" : undefined, q, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/events${params.size ? `?${params}` : ""}`;
  };
  const chip = (active: boolean) => cn("rounded-full border px-4 py-2 text-sm font-medium transition whitespace-nowrap", active ? "border-brand bg-brand text-black" : "border-border text-muted hover:border-border-strong hover:text-foreground");

  return (
    <>
      <PageHero eyebrow="What's on" title="Events &" highlight="tournaments." body="Rapid and blitz tournaments, training camps, hangouts and community nights." />
      <Container className="py-12">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            <Link href={link({ when: undefined })} className={chip(when === "upcoming")}>Upcoming</Link>
            {settings.events.showPastEvents && <Link href={link({ when: "past" })} className={chip(when === "past")}>Past</Link>}
            <span className="mx-1 w-px shrink-0 bg-border" />
            <Link href={link({ type: undefined })} className={chip(!type)}>All</Link>
            {TYPES.map((t) => <Link key={t} href={link({ type: t })} className={chip(type === t)}>{humanize(t)}</Link>)}
          </div>
          <form role="search" className="w-full lg:w-72">
            {type && <input type="hidden" name="type" value={type} />}
            {when === "past" && <input type="hidden" name="when" value="past" />}
            <input name="q" defaultValue={q} placeholder="Search events…" className="h-11 w-full rounded-full border border-border bg-surface px-5 text-sm outline-none focus:border-brand" />
          </form>
        </div>
        {events.length ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {events.map((e, i) => <Reveal key={e.id} delay={(i % 3) * 90}><EventCard event={e} timezone={settings.general.timezone} seatsLeft={seats[i]} /></Reveal>)}
          </div>
        ) : (
          <EmptyState icon={<CalendarDays />} title={when === "past" ? "No past events found" : "No upcoming events"} description={q || type ? "Try clearing the filters." : "New tournaments and hangouts will be announced here."} />
        )}
      </Container>
    </>
  );
}
