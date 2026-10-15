import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, CalendarDays, MapPin } from "lucide-react";
import { prisma } from "@/server/db";
import { getAllSettings } from "@/server/settings";
import { registrationClosedReason, seatsTaken } from "@/server/events";
import { deadlineState, formEventInclude, sessionDates, sessionsTaken } from "@/server/event-registrations";
import { activeProvider } from "@/server/payments/registry";
import { Container } from "@/components/site/cards";
import { EventRegistrationForm } from "@/components/site/event-registration-form";
import { parseFormFields } from "@/lib/event-form";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

async function load(slug: string) {
  return prisma.event.findFirst({ where: { slug, deletedAt: null, archivedAt: null, status: { in: ["PUBLISHED", "COMPLETED", "CANCELLED"] } }, include: formEventInclude });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const event = await load((await params).slug);
  return event ? { title: `Register · ${event.title}`, alternates: { canonical: `/events/${event.slug}/register` } } : { title: "Event not found" };
}

/** Focused, step-by-step registration for events that use a registration form. */
export default async function RegisterPage({ params }: { params: Promise<{ slug: string }> }) {
  const event = await load((await params).slug);
  if (!event) notFound();
  if (event.registrationMode !== "FORM") redirect(`/events/${event.slug}`);
  const settings = await getAllSettings();
  const tz = settings.general.timezone;
  const now = new Date();
  const [taken, totalTaken, provider] = await Promise.all([sessionsTaken(event.id), seatsTaken(event.id), event.onlinePayment ? activeProvider() : null]);
  const onlinePayment = provider ? (await provider.impl.readiness()).ready : false;
  const closed = registrationClosedReason(event) ?? (event.capacity !== null && totalTaken >= event.capacity ? "This event is fully booked." : null);
  const venue = event.venueNote || event.location?.name;

  return (
    <div className="min-h-[70vh] bg-surface-2/40">
      <div className="border-b border-border bg-background">
        <Container className="py-5 sm:py-8">
          <Link href={`/events/${event.slug}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted hover:text-foreground"><ArrowLeft className="size-4" />Event details</Link>
          <div className="mt-1 flex items-center gap-4">
            <span aria-hidden className="hidden size-14 shrink-0 place-items-center rounded-2xl bg-brand text-3xl text-brand-foreground sm:grid">♞</span>
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">{event.title}</h1>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                <span className="flex items-center gap-1.5"><CalendarDays className="size-4 text-brand-ink" />{sessionDates(event, tz)} {formatDate(event.endsAt, tz, { year: "numeric" })}</span>
                {venue && <span className="flex items-center gap-1.5"><MapPin className="size-4 text-brand-ink" />{venue}</span>}
              </div>
            </div>
          </div>
        </Container>
      </div>
      <Container className="py-6 sm:py-10">
        {closed ? (
          <p className="mx-auto flex max-w-2xl items-center gap-3 rounded-2xl bg-surface p-5 text-muted"><AlertTriangle className="size-5 shrink-0 text-warning" />{closed}</p>
        ) : (
          <EventRegistrationForm
            eventId={event.id}
            fields={parseFormFields(event.formFields)}
            sessions={event.sessions.map((s) => ({
              id: s.id,
              label: s.label,
              dates: sessionDates(s, tz),
              deadline: s.paymentDeadline ? formatDate(s.paymentDeadline, tz, { weekday: "short", day: "numeric", month: "short" }) : null,
              deadlineState: deadlineState(s.paymentDeadline, now),
              full: s.capacity !== null && (taken.get(s.id) ?? 0) >= s.capacity,
              finished: s.endsAt < now,
            }))}
            packages={event.packages.map((p) => ({ id: p.id, name: p.name, price: p.price.toNumber(), description: p.description }))}
            currency={event.currency}
            sessionLabel={event.sessionLabel}
            minSessions={event.minSessions}
            submitLabel={event.submitLabel || "Register"}
            paymentInstructions={event.paymentInstructions}
            onlinePayment={onlinePayment}
          />
        )}
      </Container>
    </div>
  );
}
