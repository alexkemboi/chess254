import Link from "next/link";
import { Download } from "lucide-react";
import type { Prisma, RegistrationStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { PageHeader, EmptyState, Stat, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterSelect, Pagination, SearchBox } from "@/components/admin/list-tools";
import { ActionButton } from "@/components/admin/admin-ui";
import { adminCancelRegistrationAction, checkInRegistrationAction } from "@/actions/admin";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { feeStatusLabel } from "@/server/event-registrations";

export const metadata = { title: "Registrations" };
const STATUSES: RegistrationStatus[] = ["PENDING", "CONFIRMED", "ATTENDED", "CANCELLED", "EXPIRED"];

const FEES = ["UNPAID", "PARTIAL", "PAID"] as const;

export default async function Registrations({ searchParams }: { searchParams: Promise<{ event?: string; status?: string; fee?: string; q?: string; page?: string }> }) {
  await requirePermission("events.manage", "/admin/registrations");
  const sp = await searchParams;
  const { timezone } = await getSettings("general");
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim().slice(0, 80);
  const where: Prisma.EventRegistrationWhereInput = {
    ...(sp.event ? { eventId: sp.event } : {}),
    ...(STATUSES.includes(sp.status as RegistrationStatus) ? { status: sp.status as RegistrationStatus } : {}),
    ...(FEES.includes(sp.fee as (typeof FEES)[number]) ? { feeStatus: sp.fee as (typeof FEES)[number] } : {}),
    ...(q ? { OR: [{ reference: { contains: q.toUpperCase() } }, { participantName: { contains: q, mode: "insensitive" } }, { contactName: { contains: q, mode: "insensitive" } }, { contactPhone: { contains: q } }, { user: { name: { contains: q, mode: "insensitive" } } }, { user: { email: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, events, event] = await Promise.all([
    prisma.eventRegistration.findMany({ where, include: { user: true, event: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 30, take: 30 }),
    prisma.eventRegistration.count({ where }),
    prisma.event.findMany({ where: { deletedAt: null }, orderBy: { startsAt: "desc" }, take: 100, select: { id: true, title: true, startsAt: true } }),
    sp.event ? prisma.event.findUnique({ where: { id: sp.event }, include: { _count: { select: { registrations: { where: { status: { in: ["CONFIRMED", "ATTENDED"] } } } } } } }) : null,
  ]);
  const attended = event ? await prisma.eventRegistration.count({ where: { eventId: event.id, status: "ATTENDED" } }) : 0;
  const money = event ? await prisma.eventRegistration.aggregate({ where: { eventId: event.id, status: { in: ["PENDING", "CONFIRMED", "ATTENDED"] } }, _sum: { price: true, amountPaid: true }, _count: true }) : null;
  const sessions = event?.registrationMode === "FORM" ? await prisma.eventSession.findMany({ where: { eventId: event.id }, orderBy: { position: "asc" }, include: { items: { where: { registration: { status: { in: ["PENDING", "CONFIRMED", "ATTENDED"] } } }, include: { package: { select: { name: true } } } } } }) : [];
  return (
    <div>
      <PageHeader title="Event registrations" description="Check players in, cancel registrations and export lists." actions={<Button asChild variant="secondary"><a href={`/admin/export/registrations${sp.event ? `?event=${sp.event}` : ""}`}><Download />Export CSV</a></Button>} />
      {event && (
        <>
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Confirmed" value={event._count.registrations} hint={`${money?._count ?? 0} active incl. pending${event.capacity ? ` · ${event.capacity} max` : ""}`} />
          <Stat label="Checked in" value={attended} />
          <Stat label="Fees paid" value={<span className="text-xl">{formatMoney(money?._sum.amountPaid ?? 0, event.currency)}</span>} hint={`of ${formatMoney(money?._sum.price ?? 0, event.currency)} booked`} />
          <Stat label="Date" value={<span className="text-xl">{formatDate(event.startsAt, timezone)}</span>} hint={<Link href={`/admin/manage/events/${event.id}`} className="text-brand-ink">Edit event</Link>} />
        </div>
        {sessions.length > 0 && (
          <div className="mb-6 overflow-x-auto rounded-2xl border border-border bg-surface">
            <Table>
              <THead><tr><TH>{event.sessionLabel}</TH><TH>Booked</TH><TH>Packages</TH><TH>Paid</TH><TH>Pay by</TH></tr></THead>
              <tbody>
                {sessions.map((s) => {
                  const byPkg = new Map<string, number>();
                  for (const i of s.items) byPkg.set(i.package.name, (byPkg.get(i.package.name) ?? 0) + 1);
                  return (
                    <TR key={s.id}>
                      <TD className="font-medium">{s.label}<div className="text-xs text-muted">{formatDate(s.startsAt, timezone, { day: "numeric", month: "short" })} – {formatDate(s.endsAt, timezone, { day: "numeric", month: "short" })}</div></TD>
                      <TD>{s.items.length}{s.capacity ? ` / ${s.capacity}` : ""}</TD>
                      <TD className="text-xs text-muted">{[...byPkg].map(([n, c]) => `${c} ${n}`).join(" · ") || "—"}</TD>
                      <TD>{s.items.filter((i) => i.paidAt).length} / {s.items.length}</TD>
                      <TD className="text-muted">{s.paymentDeadline ? formatDate(s.paymentDeadline, timezone, { day: "numeric", month: "short" }) : "—"}</TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
        </>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchBox placeholder="Name, email or reference…" defaultValue={q} />
        <FilterSelect name="event" label="All events" value={sp.event} options={events.map((e) => ({ value: e.id, label: `${e.title} · ${formatDate(e.startsAt, timezone)}` }))} />
        <FilterSelect name="status" label="Any status" value={sp.status} options={STATUSES.map((s) => ({ value: s, label: s.toLowerCase() }))} />
        <FilterSelect name="fee" label="Any payment" value={sp.fee} options={FEES.map((s) => ({ value: s, label: feeStatusLabel(s).toLowerCase() }))} />
      </div>
      {rows.length === 0 ? <EmptyState title="No registrations" /> : (
        <>
          <Table>
            <THead><tr><TH>Ref</TH><TH>Participant</TH><TH>Event</TH><TH>Fee</TH><TH>Registered</TH><TH>Status</TH><TH /></tr></THead>
            <tbody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="font-mono text-xs"><Link href={`/admin/registrations/${r.id}`} className="text-brand-ink hover:underline">{r.reference}</Link></TD>
                  <TD>
                    <Link href={`/admin/registrations/${r.id}`} className="hover:text-brand-ink">{r.participantName ?? r.user.name}</Link>
                    <div className="text-xs text-muted">{r.contactName && r.contactName !== r.participantName ? `${r.contactName} · ` : ""}{r.contactPhone ?? r.user.phone ?? r.user.email}</div>
                  </TD>
                  <TD>{r.event.title}</TD>
                  <TD className="text-xs">
                    <span className="font-mono">{r.price.greaterThan(0) ? formatMoney(r.price, r.currency) : "Free"}</span>
                    {r.price.greaterThan(0) && r.event.registrationMode === "FORM" && <div className="mt-1"><StatusBadge status={r.feeStatus === "PARTIAL" ? "PARTIALLY_PAID" : r.feeStatus === "UNPAID" ? "PENDING" : "PAID"} /></div>}
                  </TD>
                  <TD className="text-muted">{formatDateTime(r.createdAt, timezone)}</TD>
                  <TD><StatusBadge status={r.status} /></TD>
                  <TD className="whitespace-nowrap text-right">
                    {r.status === "CONFIRMED" && <ActionButton action={checkInRegistrationAction.bind(null, r.id)} variant="ghost">Check in</ActionButton>}
                    {(r.status === "CONFIRMED" || r.status === "PENDING") && <ActionButton action={adminCancelRegistrationAction.bind(null, r.id)} variant="ghost" confirm="Cancel this registration? The player is notified.">Cancel</ActionButton>}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} total={total} pageSize={30} />
        </>
      )}
    </div>
  );
}
