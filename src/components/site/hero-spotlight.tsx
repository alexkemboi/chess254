import Link from "next/link";
import { ArrowRight, CalendarDays, Clock, MapPin } from "lucide-react";
import { Img } from "@/components/ui/img";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ShareEvent } from "@/components/site/share-event";

export type Spotlight = {
  slug: string;
  title: string;
  typeLabel: string;
  excerpt: string | null;
  coverImage: string | null;
  startMonth: string;
  startDay: string;
  endMonth: string;
  endDay: string;
  dateRange: string;
  duration: string | null;
  venue: string | null;
  packages: { name: string; price: string }[];
  unit: string;
  deadline: { text: string; urgent: boolean } | null;
  ctaLabel: string;
  isForm: boolean;
  shareUrl: string;
};

/** The featured event, shown as the first and largest thing on the homepage. */
export function HeroSpotlight({ event }: { event: Spotlight }) {
  const href = `/events/${event.slug}`;
  return (
    <div className="art-tile on-dark relative animate-fade-up overflow-hidden rounded-[2.25rem] border border-white/10 shadow-2xl">
      <div className="pointer-events-none absolute -right-24 -top-24 size-[420px] rounded-full bg-brand/30 blur-[120px]" aria-hidden />
      <div className="relative grid lg:grid-cols-[1.45fr_1fr]">
        <div className="min-w-0 p-6 sm:p-10 lg:p-14">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-brand px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-brand-foreground">
              <span className="size-2 animate-pulse rounded-full bg-current" />Now booking
            </span>
            <span className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted">{event.typeLabel}</span>
          </div>
          <h2 className="display mt-6 text-[clamp(2.7rem,7.5vw,6.2rem)]">
            <Link href={href} className="hover:text-brand-ink">{event.title}</Link>
          </h2>
          {event.excerpt && <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">{event.excerpt}</p>}
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm sm:text-base">
            <span className="flex items-center gap-2 font-semibold"><CalendarDays className="size-5 text-brand-ink" />{event.dateRange}</span>
            {event.duration && <span className="flex items-center gap-2"><Clock className="size-5 text-brand-ink" />{event.duration}</span>}
            {event.venue && <span className="flex items-center gap-2"><MapPin className="size-5 text-brand-ink" />{event.venue}</span>}
          </div>
          {event.packages.length > 0 && (
            <div className="mt-7 flex flex-wrap gap-3">
              {event.packages.map((p) => (
                <div key={p.name} className="rounded-2xl border border-white/12 bg-white/[0.06] px-4 py-3 backdrop-blur">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted">{p.name}</div>
                  <div className="mt-0.5 font-display text-2xl font-black">{p.price}<span className="ml-1 font-sans text-sm font-medium text-muted">/ {event.unit}</span></div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg"><Link href={event.isForm ? `${href}/register` : href}>{event.ctaLabel}<ArrowRight /></Link></Button>
            <Button asChild size="lg" variant="outline" className="border-white/30 hover:border-brand"><Link href={href}>Programme &amp; details</Link></Button>
          </div>
          {event.deadline && <p className={cn("mt-5 text-sm", event.deadline.urgent ? "font-semibold text-warning" : "text-muted")}>{event.deadline.text}</p>}
          <ShareEvent variant="dark" className="mt-5" url={event.shareUrl} title={event.title} text={`${event.title}${event.venue ? ` — ${event.venue}` : ""}, ${event.dateRange}. Register here:`} />
        </div>

        <div className="relative min-h-[240px] border-t border-white/10 lg:min-h-full lg:border-l lg:border-t-0">
          {event.coverImage ? (
            <>
              <Img src={event.coverImage} alt={event.title} fill sizes="(max-width: 1024px) 100vw, 40vw" className="object-cover" priority />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
            </>
          ) : (
            <span aria-hidden className="absolute -bottom-10 right-4 font-display text-[260px] leading-none text-white/[0.07] sm:text-[340px]">♞</span>
          )}
          <div className="relative flex h-full items-end justify-center p-6 sm:p-10 lg:items-center">
            <div className="flex items-center gap-3 rounded-3xl bg-black/55 p-4 backdrop-blur sm:gap-5 sm:p-6">
              <DateBlock month={event.startMonth} day={event.startDay} />
              {(event.startMonth !== event.endMonth || event.startDay !== event.endDay) && (
                <>
                  <ArrowRight className="size-6 shrink-0 text-brand-ink" />
                  <DateBlock month={event.endMonth} day={event.endDay} />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DateBlock({ month, day }: { month: string; day: string }) {
  return (
    <div className="text-center">
      <div className="text-xs font-bold uppercase tracking-widest text-brand-ink sm:text-sm">{month}</div>
      <div className="font-display text-5xl font-black leading-none sm:text-6xl">{day}</div>
    </div>
  );
}
