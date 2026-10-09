import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { CancelRegistrationButton } from "@/components/site/event-register";
import { formatDateTime, formatMoney } from "@/lib/format";

export default async function MyEventsPage() {
  const user = await requireUser("/dashboard/events");
  const { timezone } = await getSettings("general");
  const now = new Date();
  const regs = await prisma.eventRegistration.findMany({ where: { userId: user.id }, include: { event: true, orderItem: { include: { order: true } } }, orderBy: { event: { startsAt: "desc" } }, take: 100 });
  return (
    <div>
      <PageHeader eyebrow="Events" title="Your registrations" actions={<Button asChild variant="secondary"><Link href="/events">Browse events</Link></Button>} />
      {regs.length === 0 ? (
        <EmptyState icon={<CalendarDays />} title="No registrations yet" description="Register for tournaments, hangouts and training camps." action={<Button asChild><Link href="/events">See what’s on</Link></Button>} />
      ) : (
        <ul className="grid gap-3">
          {regs.map((r) => {
            const upcoming = r.event.startsAt > now;
            const pending = r.status === "PENDING" && r.holdExpiresAt && r.holdExpiresAt > now && r.orderItem;
            return (
              <li key={r.id} className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><Link href={`/events/${r.event.slug}`} className="font-semibold hover:text-brand-ink">{r.event.title}</Link><StatusBadge status={r.status} /></div>
                  <div className="mt-1 text-sm text-muted">{formatDateTime(r.event.startsAt, timezone)} · <span className="font-mono">{r.reference}</span>{r.price.greaterThan(0) ? ` · ${formatMoney(r.price, r.currency)}` : " · Free"}</div>
                </div>
                <div className="flex gap-2">
                  {pending && <Button asChild size="sm"><Link href={`/pay/${r.orderItem!.orderId}`}>Pay now</Link></Button>}
                  {upcoming && (r.status === "CONFIRMED" || r.status === "PENDING") && <CancelRegistrationButton registrationId={r.id} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
