import { Img as Image } from "@/components/ui/img";
import Link from "next/link";
import { ArrowUpRight, Calendar, Check, MapPin, Users } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { BILLING_PERIOD_LABELS, formatDate, formatMoney, formatTime, humanize } from "@/lib/format";
import { cn, initials } from "@/lib/utils";

export function SectionHeading({ eyebrow, title, highlight, body, action, center = false }: { eyebrow?: string | null; title?: string | null; highlight?: string | null; body?: string | null; action?: React.ReactNode; center?: boolean }) {
  return (
    <div className={cn("mb-10 flex flex-col gap-5 lg:mb-14", center ? "items-center text-center" : "lg:flex-row lg:items-end lg:justify-between")}>
      <div className={cn("max-w-3xl", center && "mx-auto")}>
        {eyebrow && <div className="eyebrow mb-4">{eyebrow}</div>}
        {(title || highlight) && (
          <h2 className="display text-[clamp(2.4rem,6vw,4.6rem)]">
            {title} {highlight && <span className="text-brand">{highlight}</span>}
          </h2>
        )}
        {body && <p className={cn("mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg", center && "mx-auto")}>{body}</p>}
      </div>
      {action}
    </div>
  );
}

type Plan = Prisma.MembershipPlanGetPayload<{ include: { features: true } }>;

export function PlanCard({ plan, current }: { plan: Plan; current?: boolean }) {
  const period = BILLING_PERIOD_LABELS[plan.billingPeriod];
  return (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-3xl border p-7 transition-all duration-500 hover:-translate-y-1 sm:p-9",
        plan.featured ? "border-brand/50 bg-gradient-to-b from-brand/[0.13] via-surface to-surface glow" : "border-border bg-surface hover:border-border-strong",
      )}
    >
      {plan.featured && <div className="absolute -right-16 -top-16 size-48 rounded-full bg-brand/25 blur-3xl transition-opacity group-hover:opacity-80" />}
      <div className="relative flex min-h-6 items-center justify-between gap-3">
        {plan.audience && <span className="eyebrow">{plan.audience}</span>}
        {current && <Badge variant="success">Your plan</Badge>}
        {plan.featured && !current && <Badge variant="solid">Most popular</Badge>}
      </div>
      <h3 className="relative mt-5 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{plan.name}</h3>
      <div className="relative mt-4 flex items-baseline gap-2">
        <span className="font-display text-4xl font-black tracking-tight sm:text-5xl">{formatMoney(plan.price, plan.currency)}</span>
        <span className="text-muted">/ {period.short}</span>
      </div>
      <p className="relative mt-4 leading-relaxed text-muted">{plan.description}</p>
      {plan.features.length > 0 && (
        <ul className="relative mt-7 grid gap-3 border-t border-border pt-7">
          {plan.features.map((f) => (
            <li key={f.id} className="flex gap-3 text-[15px] leading-snug">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Check className="size-3" strokeWidth={3} /></span>
              {f.label}
            </li>
          ))}
        </ul>
      )}
      <div className="min-h-9 flex-1" />
      <Link href={`/join/${plan.slug}`} className={cn(buttonVariants({ variant: plan.featured ? "default" : "white", size: "lg" }), "relative w-full")}>
        {plan.ctaLabel || `Choose ${formatMoney(plan.price, plan.currency)}`}
        <ArrowUpRight />
      </Link>
    </article>
  );
}

type EventLite = Prisma.EventGetPayload<{ include: { location: true } }>;

export function EventCard({ event, timezone, seatsLeft }: { event: EventLite; timezone: string; seatsLeft?: number | null }) {
  const free = !Number(event.price);
  return (
    <Link href={`/events/${event.slug}`} className="group flex flex-col overflow-hidden rounded-3xl border border-border bg-surface transition-all duration-500 hover:-translate-y-1 hover:border-border-strong">
      <div className="relative aspect-[16/10] overflow-hidden bg-surface-2">
        {event.coverImage ? (
          <Image src={event.coverImage} alt={event.title} fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover transition-transform duration-700 group-hover:scale-105" />
        ) : (
          <div className="checker absolute inset-0 grid place-items-center text-6xl text-brand/40">♜</div>
        )}
        <div className="absolute left-4 top-4 rounded-2xl bg-black/75 px-3 py-2 text-center backdrop-blur">
          <div className="text-[10px] font-bold uppercase tracking-widest text-brand">{formatDate(event.startsAt, timezone, { month: "short" })}</div>
          <div className="font-display text-2xl font-black leading-none">{formatDate(event.startsAt, timezone, { day: "numeric" })}</div>
        </div>
        <Badge variant={free ? "success" : "solid"} className="absolute right-4 top-4">{free ? "Free" : formatMoney(event.price, event.currency)}</Badge>
      </div>
      <div className="flex flex-1 flex-col p-6">
        <div className="eyebrow text-muted">{humanize(event.type)}</div>
        <h3 className="mt-2 font-display text-xl font-bold tracking-tight group-hover:text-brand">{event.title}</h3>
        {event.excerpt && <p className="mt-2 line-clamp-2 text-sm text-muted">{event.excerpt}</p>}
        <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1.5 pt-5 text-xs text-muted">
          <span className="flex items-center gap-1.5"><Calendar className="size-3.5 text-brand" />{formatTime(event.startsAt, timezone)}</span>
          {(event.location || event.venueNote) && <span className="flex items-center gap-1.5"><MapPin className="size-3.5 text-brand" />{event.venueNote || event.location?.name}</span>}
          {seatsLeft !== undefined && seatsLeft !== null && <span className="flex items-center gap-1.5"><Users className="size-3.5 text-brand" />{seatsLeft > 0 ? `${seatsLeft} seats left` : "Full"}</span>}
        </div>
      </div>
    </Link>
  );
}

type CoachLite = Prisma.CoachProfileGetPayload<{ include: { user: { select: { name: true } } } }>;

export function CoachCard({ coach }: { coach: CoachLite }) {
  return (
    <Link href={`/coaches/${coach.slug}`} className="group relative block overflow-hidden rounded-3xl border border-border bg-surface transition-all duration-500 hover:-translate-y-1 hover:border-brand/50">
      <div className="relative aspect-[4/5] overflow-hidden bg-surface-2">
        {coach.imageUrl ? (
          <Image src={coach.imageUrl} alt={coach.user.name} fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover grayscale-[35%] transition duration-700 group-hover:scale-105 group-hover:grayscale-0" />
        ) : (
          <div className="checker absolute inset-0 grid place-items-center font-display text-6xl font-black text-brand/60">{initials(coach.user.name)}</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-5">
          {coach.title && <div className="eyebrow">{coach.title}</div>}
          <h3 className="mt-1 font-display text-2xl font-extrabold tracking-tight">{coach.user.name}</h3>
          {coach.headline && <p className="mt-1 line-clamp-2 text-sm text-white/70">{coach.headline}</p>}
          {coach.rating && <div className="mt-2 font-mono text-xs text-brand">Rating {coach.rating}</div>}
        </div>
      </div>
    </Link>
  );
}

export function Container({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-7xl px-4 sm:px-6", className)}>{children}</div>;
}

export function PageHero({ eyebrow, title, highlight, body, children }: { eyebrow?: string | null; title: string; highlight?: string | null; body?: string | null; children?: React.ReactNode }) {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-60" />
      <div className="pointer-events-none absolute -top-40 right-0 size-[520px] rounded-full bg-brand/15 blur-[120px]" />
      <Container className="relative py-16 sm:py-24">
        {eyebrow && <div className="eyebrow mb-5 animate-fade-up">{eyebrow}</div>}
        <h1 className="display animate-fade-up text-[clamp(2.8rem,8vw,6rem)] [animation-delay:80ms]">
          {title} {highlight && <span className="text-brand">{highlight}</span>}
        </h1>
        {body && <p className="mt-6 max-w-2xl animate-fade-up text-lg leading-relaxed text-muted [animation-delay:160ms]">{body}</p>}
        {children && <div className="mt-8 animate-fade-up [animation-delay:240ms]">{children}</div>}
      </Container>
    </section>
  );
}
