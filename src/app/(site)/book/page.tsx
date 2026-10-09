import Link from "next/link";
import { CalendarX } from "lucide-react";
import { prisma } from "@/server/db";
import { currentUser } from "@/server/auth";
import { bookingContext } from "@/server/booking";
import { Container, PageHero } from "@/components/site/cards";
import { BookingCalendar } from "@/components/site/booking-calendar";
import { EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";

export const metadata = { title: "Book a session", description: "Book coaching, game reviews and guided sessions at the clubhouse.", alternates: { canonical: "/book" } };

export default async function BookPage({ searchParams }: { searchParams: Promise<{ type?: string; coach?: string }> }) {
  const { type, coach } = await searchParams;
  const [user, ctx, sessionTypes] = await Promise.all([
    currentUser(),
    bookingContext(),
    prisma.sessionType.findMany({
      where: { status: "ACTIVE" },
      orderBy: { position: "asc" },
      include: { coaches: { where: { isActive: true, acceptsBookings: true }, select: { id: true, slug: true, user: { select: { name: true } } } } },
    }),
  ]);
  const coachMap = new Map(sessionTypes.flatMap((s) => s.coaches.map((c) => [c.id, c])));
  const coachBySlug = coach ? [...coachMap.values()].find((c) => c.slug === coach || c.id === coach) : undefined;
  const cancellation = ctx.settings.booking.cancellationPolicy;

  return (
    <>
      <PageHero glyph="♚" eyebrow="Coaching & sessions" title="Book your" highlight="next session." body="Pick a session, choose a date and grab a time with a resident coach. Availability updates live." />
      <Container className="py-12">
        {sessionTypes.length === 0 ? (
          <EmptyState icon={<CalendarX />} title="Booking opens soon" description="Session types haven't been published yet. Check back shortly." action={<Button asChild variant="secondary"><Link href="/contact">Ask the club</Link></Button>} />
        ) : (
          <BookingCalendar
            timezone={ctx.timezone}
            signedIn={Boolean(user)}
            initialType={type}
            initialCoach={coachBySlug?.id}
            coaches={[...coachMap.values()].map((c) => ({ id: c.id, name: c.user.name }))}
            sessionTypes={sessionTypes.map((s) => ({
              id: s.id,
              name: s.name,
              description: s.description,
              durationMinutes: s.durationMinutes,
              priceLabel: s.price.greaterThan(0) ? formatMoney(s.price, s.currency) : "Included",
              capacity: s.capacity,
              membershipRequired: s.membershipRequired,
              coachIds: s.coaches.map((c) => c.id),
              cancellationPolicy: s.cancellationPolicy || cancellation || null,
            }))}
          />
        )}
      </Container>
    </>
  );
}
