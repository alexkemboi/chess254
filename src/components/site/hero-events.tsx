"use client";
import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Calendar, ChevronLeft, ChevronRight, MapPin, Pin, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export type HeroEvent = {
  id: string;
  slug: string;
  title: string;
  typeLabel: string;
  excerpt: string | null;
  coverImage: string | null;
  month: string;
  day: string;
  when: string;
  venue: string | null;
  priceLabel: string;
  pinned: boolean;
  seatsLabel: string | null;
};

/** Long dwell so each event can be read properly before the next one slides in. */
const INTERVAL_MS = 12_000;
const SLIDE_MS = 1200;

/**
 * Pinned / upcoming events as a large slider at the foot of the homepage hero.
 * Auto-advances slowly, pauses while hovered, focused or the tab is hidden, and
 * never auto-plays for visitors who prefer reduced motion.
 */
export function HeroEvents({ events }: { events: HeroEvent[] }) {
  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [reduced, setReduced] = React.useState(false);
  const [cycle, setCycle] = React.useState(0);
  const count = events.length;

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  React.useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const autoplay = count > 1 && !paused && !reduced;
  React.useEffect(() => {
    if (!autoplay) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % count), INTERVAL_MS);
    return () => clearTimeout(t);
  }, [autoplay, index, count, cycle]);

  const go = (next: number) => {
    setIndex(((next % count) + count) % count);
    setCycle((c) => c + 1);
  };

  if (!count) return null;
  const current = events[index];

  return (
    <div
      className="relative w-full min-w-0 animate-fade-up [animation-delay:360ms]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
      role="region"
      aria-roledescription="carousel"
      aria-label="Upcoming events"
    >
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <div className="eyebrow flex items-center gap-2"><Pin className="size-3.5 text-brand-ink" />{current?.pinned ? "Pinned event" : "Coming up"}</div>
          <div className="mt-1 font-display text-2xl font-extrabold tracking-tight sm:text-3xl">Don&apos;t miss what&apos;s on</div>
        </div>
        {count > 1 && (
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => go(index - 1)} className="grid size-11 place-items-center rounded-full border border-border-strong bg-surface text-muted transition hover:border-brand hover:text-foreground" aria-label="Previous event"><ChevronLeft className="size-5" /></button>
            <button type="button" onClick={() => go(index + 1)} className="grid size-11 place-items-center rounded-full border border-border-strong bg-surface text-muted transition hover:border-brand hover:text-foreground" aria-label="Next event"><ChevronRight className="size-5" /></button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-[2rem] border border-border-strong bg-surface shadow-2xl">
        <div className="flex ease-[cubic-bezier(0.22,0.61,0.36,1)] motion-reduce:transition-none" style={{ transform: `translateX(-${index * 100}%)`, transitionProperty: "transform", transitionDuration: `${SLIDE_MS}ms` }}>
          {events.map((e, i) => (
            <Link
              key={e.id}
              href={`/events/${e.slug}`}
              className="group grid w-full shrink-0 md:grid-cols-[1.25fr_1fr]"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}: ${e.title}`}
              aria-hidden={i !== index}
              tabIndex={i === index ? 0 : -1}
            >
              <div className="relative aspect-[16/10] overflow-hidden bg-surface-2 md:aspect-auto md:min-h-[360px]">
                {e.coverImage ? (
                  <Image src={e.coverImage} alt={e.title} fill sizes="(max-width: 768px) 100vw, 60vw" className="object-cover transition-transform duration-[1.5s] group-hover:scale-105" />
                ) : (
                  <div className="art-tile on-dark absolute inset-0 grid place-items-center"><span aria-hidden className="font-display text-[180px] leading-none text-white/[0.1]">♜</span></div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent md:bg-gradient-to-r md:from-transparent md:to-black/10" />
                <div className="on-dark absolute left-4 top-4 rounded-2xl bg-black/75 px-4 py-2.5 text-center backdrop-blur sm:left-6 sm:top-6">
                  <div className="text-xs font-bold uppercase tracking-widest text-brand-ink">{e.month}</div>
                  <div className="font-display text-4xl font-black leading-none">{e.day}</div>
                </div>
                {e.pinned && <div className="on-dark absolute right-4 top-4 flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-brand-foreground sm:right-6 sm:top-6"><Pin className="size-3.5" />Pinned</div>}
              </div>
              <div className="flex min-w-0 flex-col p-6 sm:p-8 lg:p-10">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                  <span>{e.typeLabel}</span>
                  <span className="rounded-full bg-brand-soft px-2.5 py-1 text-brand-ink">{e.priceLabel}</span>
                </div>
                <h3 className="mt-3 line-clamp-3 font-display text-3xl font-extrabold leading-tight tracking-tight group-hover:text-brand-ink sm:text-4xl">{e.title}</h3>
                {e.excerpt && <p className="mt-4 line-clamp-3 text-base leading-relaxed text-muted">{e.excerpt}</p>}
                <div className="mt-6 grid gap-2.5 text-sm">
                  <span className="flex items-center gap-2"><Calendar className="size-4 shrink-0 text-brand-ink" />{e.when}</span>
                  {e.venue && <span className="flex min-w-0 items-center gap-2"><MapPin className="size-4 shrink-0 text-brand-ink" /><span className="truncate">{e.venue}</span></span>}
                  {e.seatsLabel && <span className="flex items-center gap-2"><Users className="size-4 shrink-0 text-brand-ink" />{e.seatsLabel}</span>}
                </div>
                <div className="mt-auto pt-8">
                  <span className="inline-flex h-12 items-center gap-2 rounded-full bg-brand px-6 font-semibold text-brand-foreground transition group-hover:gap-3">View event &amp; register<ArrowRight className="size-4" /></span>
                </div>
              </div>
            </Link>
          ))}
        </div>
        {count > 1 && (
          <div className="h-1 w-full bg-border">
            <div
              key={`${index}-${cycle}`}
              className="h-full origin-left bg-brand"
              style={{ animation: autoplay ? `hero-events-progress ${INTERVAL_MS}ms linear both` : "none", transform: autoplay ? undefined : "scaleX(0)" }}
            />
          </div>
        )}
      </div>

      {count > 1 && (
        <div className="mt-4 flex justify-center gap-2">
          {events.map((e, i) => (
            <button key={e.id} type="button" onClick={() => go(i)} aria-label={`Show ${e.title}`} aria-current={i === index} className={cn("h-2 rounded-full transition-all duration-700", i === index ? "w-8 bg-brand" : "w-2 bg-foreground/20 hover:bg-foreground/40")} />
          ))}
        </div>
      )}
    </div>
  );
}
