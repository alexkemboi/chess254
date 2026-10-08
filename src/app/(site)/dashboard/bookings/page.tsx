import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getAllSettings } from "@/server/settings";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { CancelBookingDialog } from "@/components/site/booking-actions";
import { formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser("/dashboard/bookings");
  const { tab } = await searchParams;
  const past = tab === "past";
  const settings = await getAllSettings();
  const now = new Date();
  const bookings = await prisma.booking.findMany({
    where: { memberId: user.id, ...(past ? { OR: [{ startsAt: { lt: now } }, { status: { in: ["CANCELLED", "EXPIRED"] } }] } : { startsAt: { gte: now }, status: { in: ["PENDING", "CONFIRMED"] } }) },
    include: { sessionType: true, coach: { include: { user: { select: { name: true } } } }, orderItem: { include: { order: true } } },
    orderBy: { startsAt: past ? "desc" : "asc" },
    take: 100,
  });
  return (
    <div>
      <PageHeader eyebrow="Coaching" title="Bookings" actions={<Button asChild><Link href="/book"><CalendarCheck />Book a session</Link></Button>} />
      <div className="mb-5 flex gap-2">
        <Link href="/dashboard/bookings" className={cn("rounded-full border px-4 py-2 text-sm", !past ? "border-brand bg-brand text-black" : "border-border text-muted")}>Upcoming</Link>
        <Link href="/dashboard/bookings?tab=past" className={cn("rounded-full border px-4 py-2 text-sm", past ? "border-brand bg-brand text-black" : "border-border text-muted")}>Past & cancelled</Link>
      </div>
      {bookings.length === 0 ? (
        <EmptyState icon={<CalendarCheck />} title={past ? "No past bookings" : "No upcoming bookings"} description={past ? undefined : "Book a lesson, review or guided session with a resident coach."} action={!past ? <Button asChild><Link href="/book">Book now</Link></Button> : undefined} />
      ) : (
        <ul className="grid gap-3">
          {bookings.map((b) => {
            const awaitingPayment = b.status === "PENDING" && b.orderItem?.order.status === "PENDING" && b.holdExpiresAt && b.holdExpiresAt > now;
            return (
              <li key={b.id} className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{b.sessionType.name}</span>
                    <StatusBadge status={b.status} />
                    {b.usedEntitlement && <Badge>Included</Badge>}
                  </div>
                  <div className="mt-1 text-sm text-muted">{formatDateTime(b.startsAt, settings.general.timezone)} · {b.coach.user.name} · <span className="font-mono">{b.reference}</span></div>
                  {b.price.greaterThan(0) && <div className="mt-1 text-xs text-muted">{formatMoney(b.price, b.currency)}{b.orderItem?.order.status === "PAID" ? " · paid" : ""}</div>}
                  {b.cancelReason && <div className="mt-1 text-xs text-danger">{b.cancelReason}</div>}
                  {b.coachNotes && b.status === "COMPLETED" && <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm"><span className="text-xs text-brand">Coach notes</span><p className="mt-1 whitespace-pre-line">{b.coachNotes}</p></div>}
                </div>
                {!past && (
                  <div className="flex shrink-0 gap-2">
                    {awaitingPayment && b.orderItem && <Button asChild size="sm"><Link href={`/pay/${b.orderItem.orderId}`}>Pay now</Link></Button>}
                    <CancelBookingDialog bookingId={b.id} policy={b.sessionType.cancellationPolicy || settings.booking.cancellationPolicy} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
