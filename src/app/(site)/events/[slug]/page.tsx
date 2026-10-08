import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CalendarDays, Clock, MapPin, Timer, Trophy, Users } from "lucide-react";
import { prisma } from "@/server/db";
import { currentUser } from "@/server/auth";
import { getAllSettings, siteUrl } from "@/server/settings";
import { eventPriceFor, registrationClosedReason, seatsTaken } from "@/server/events";
import { Container } from "@/components/site/cards";
import { Img } from "@/components/ui/img";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CancelRegistrationButton, RegisterEventButton } from "@/components/site/event-register";
import { formatDate, formatMoney, formatTime, humanize } from "@/lib/format";
import { plainText, truncate } from "@/lib/utils";

async function load(slug: string) {
  return prisma.event.findFirst({ where: { slug, deletedAt: null, status: { in: ["PUBLISHED", "COMPLETED", "CANCELLED"] } }, include: { location: true } });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const event = await load((await params).slug);
  if (!event) return { title: "Event not found" };
  const description = event.seoDescription ?? event.excerpt ?? truncate(plainText(event.description), 160);
  return { title: event.seoTitle ?? event.title, description, alternates: { canonical: `/events/${event.slug}` }, openGraph: { type: "article", images: event.coverImage ? [event.coverImage] : undefined, description } };
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const event = await load((await params).slug);
  if (!event) notFound();
  const [user, settings] = await Promise.all([currentUser(), getAllSettings()]);
  const tz = settings.general.timezone;
  const taken = await seatsTaken(event.id);
  const left = event.capacity === null ? null : Math.max(0, event.capacity - taken);
  const closed = registrationClosedReason(event);
  const mine = user ? await prisma.eventRegistration.findUnique({ where: { eventId_userId: { eventId: event.id, userId: user.id } }, include: { orderItem: true } }) : null;
  const { price, member } = await eventPriceFor(event, user?.id ?? null);
  const free = !price.greaterThan(0);
  const minePending = mine?.status === "PENDING" && mine.holdExpiresAt && mine.holdExpiresAt > new Date();
  const base = await siteUrl();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: event.excerpt ?? truncate(plainText(event.description), 300),
    startDate: event.startsAt.toISOString(),
    endDate: event.endsAt.toISOString(),
    eventStatus: event.status === "CANCELLED" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    image: event.coverImage ? [`${base}${event.coverImage}`] : undefined,
    location: event.location ? { "@type": "Place", name: event.location.name, address: `${event.location.address}, ${event.location.city}` } : undefined,
    offers: { "@type": "Offer", price: event.price.toString(), priceCurrency: event.currency, url: `${base}/events/${event.slug}`, availability: left === 0 ? "https://schema.org/SoldOut" : "https://schema.org/InStock" },
    organizer: { "@type": "Organization", name: settings.general.siteName, url: base },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <section className="relative overflow-hidden border-b border-border">
        {event.coverImage && (
          <div className="absolute inset-0">
            <Img src={event.coverImage} alt="" fill priority sizes="100vw" className="scale-110 object-cover opacity-25 blur-2xl" />
            <div className="absolute inset-0 bg-gradient-to-b from-background/40 to-background" />
          </div>
        )}
        <Container className="relative grid gap-10 py-12 sm:py-20 lg:grid-cols-[1.3fr_1fr] lg:items-center">
          <div>
            <Link href="/events" className="text-sm text-muted hover:text-foreground">← All events</Link>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Badge>{humanize(event.type)}</Badge>
              {event.status !== "PUBLISHED" && <StatusBadge status={event.status} />}
            </div>
            <h1 className="display mt-4 text-[clamp(2.6rem,7vw,5.4rem)]">{event.title}</h1>
            {event.excerpt && <p className="mt-5 max-w-xl text-lg text-muted">{event.excerpt}</p>}
            <div className="mt-8 grid gap-3 text-sm sm:grid-cols-2">
              <Info icon={<CalendarDays />} label="Date" value={formatDate(event.startsAt, tz, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} />
              <Info icon={<Clock />} label="Time" value={`${formatTime(event.startsAt, tz)} – ${formatTime(event.endsAt, tz)}`} />
              {(event.location || event.venueNote) && <Info icon={<MapPin />} label="Venue" value={[event.venueNote, event.location && `${event.location.name}, ${event.location.address}`].filter(Boolean).join(" · ")} />}
              {event.timeControl && <Info icon={<Timer />} label="Time control" value={event.timeControl} />}
              {event.format && <Info icon={<Trophy />} label="Format" value={event.format} />}
              {event.capacity !== null && <Info icon={<Users />} label="Capacity" value={`${left} of ${event.capacity} seats left`} />}
            </div>
          </div>
          <div className="rounded-3xl border border-border-strong bg-surface/90 p-7 backdrop-blur">
            {event.coverImage && (
              <div className="relative -mx-7 -mt-7 mb-6 aspect-[16/10] overflow-hidden rounded-t-3xl">
                <Img src={event.coverImage} alt={event.title} fill sizes="(max-width: 1024px) 100vw, 40vw" className="object-cover" />
              </div>
            )}
            <div className="text-sm text-muted">Entry</div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="font-display text-4xl font-black">{free ? "Free" : formatMoney(price, event.currency)}</span>
              {member && event.memberPrice !== null && price.lessThan(event.price) && <span className="text-sm text-muted line-through">{formatMoney(event.price, event.currency)}</span>}
            </div>
            {!member && event.memberPrice !== null && event.memberPrice.lessThan(event.price) && <p className="mt-1 text-sm text-brand">Members pay {formatMoney(event.memberPrice, event.currency)}</p>}
            {event.capacity !== null && left !== null && (
              <div className="mt-5">
                <div className="h-2 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.min(100, (taken / event.capacity) * 100)}%` }} /></div>
                <div className="mt-2 text-xs text-muted">{taken} registered · {left} left</div>
              </div>
            )}
            <div className="mt-6">
              {mine && (mine.status === "CONFIRMED" || mine.status === "ATTENDED") ? (
                <div className="grid gap-3">
                  <div className="rounded-2xl bg-success/10 p-4 text-sm text-success">You’re registered · {mine.reference}</div>
                  {event.status === "PUBLISHED" && event.startsAt > new Date() && <CancelRegistrationButton registrationId={mine.id} />}
                </div>
              ) : minePending && mine?.orderItem ? (
                <Button asChild size="lg" className="w-full"><Link href={`/pay/${mine.orderItem.orderId}`}>Complete payment</Link></Button>
              ) : closed ? (
                <p className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">{closed}</p>
              ) : left === 0 ? (
                <p className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">This event is full.</p>
              ) : user ? (
                <RegisterEventButton eventId={event.id} label={free ? "Register free" : `Register · ${formatMoney(price, event.currency)}`} />
              ) : (
                <Button asChild size="lg" className="w-full"><Link href={`/login?next=/events/${event.slug}`}>Sign in to register</Link></Button>
              )}
            </div>
            {event.registrationDeadline && !closed && <p className="mt-3 text-xs text-muted">Registration closes {formatDate(event.registrationDeadline, tz, { day: "numeric", month: "short" })} at {formatTime(event.registrationDeadline, tz)}.</p>}
          </div>
        </Container>
      </section>
      <Container className="grid gap-10 py-14 lg:grid-cols-[1.3fr_1fr]">
        <article className="prose-chess max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{event.description}</ReactMarkdown></article>
        {event.prizeInfo && (
          <aside className="h-fit rounded-3xl border border-brand/30 bg-brand-soft p-6">
            <Trophy className="size-6 text-brand" />
            <h2 className="mt-3 font-display text-xl font-bold">Prizes</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{event.prizeInfo}</p>
          </aside>
        )}
      </Container>
    </>
  );
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface/70 p-4">
      <span className="text-brand [&_svg]:size-4">{icon}</span>
      <div><div className="text-xs text-muted">{label}</div><div className="mt-0.5 font-medium">{value}</div></div>
    </div>
  );
}
