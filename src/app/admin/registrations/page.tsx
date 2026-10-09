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

export const metadata = { title: "Registrations" };
const STATUSES: RegistrationStatus[] = ["PENDING", "CONFIRMED", "ATTENDED", "CANCELLED", "EXPIRED"];

export default async function Registrations({ searchParams }: { searchParams: Promise<{ event?: string; status?: string; q?: string; page?: string }> }) {
  await requirePermission("events.manage", "/admin/registrations");
  const sp = await searchParams;
  const { timezone } = await getSettings("general");
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim().slice(0, 80);
  const where: Prisma.EventRegistrationWhereInput = {
    ...(sp.event ? { eventId: sp.event } : {}),
    ...(STATUSES.includes(sp.status as RegistrationStatus) ? { status: sp.status as RegistrationStatus } : {}),
    ...(q ? { OR: [{ reference: { contains: q.toUpperCase() } }, { user: { name: { contains: q, mode: "insensitive" } } }, { user: { email: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, events, event] = await Promise.all([
    prisma.eventRegistration.findMany({ where, include: { user: true, event: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 30, take: 30 }),
    prisma.eventRegistration.count({ where }),
    prisma.event.findMany({ where: { deletedAt: null }, orderBy: { startsAt: "desc" }, take: 100, select: { id: true, title: true, startsAt: true } }),
    sp.event ? prisma.event.findUnique({ where: { id: sp.event }, include: { _count: { select: { registrations: { where: { status: { in: ["CONFIRMED", "ATTENDED"] } } } } } } }) : null,
  ]);
  const attended = event ? await prisma.eventRegistration.count({ where: { eventId: event.id, status: "ATTENDED" } }) : 0;
  return (
    <div>
      <PageHeader title="Event registrations" description="Check players in, cancel registrations and export lists." actions={<Button asChild variant="secondary"><a href={`/admin/export/registrations${sp.event ? `?event=${sp.event}` : ""}`}><Download />Export CSV</a></Button>} />
      {event && (
        <div className="mb-6 grid grid-cols-3 gap-3">
          <Stat label="Confirmed" value={event._count.registrations} hint={event.capacity ? `of ${event.capacity} seats` : "No capacity limit"} />
          <Stat label="Checked in" value={attended} />
          <Stat label="Date" value={<span className="text-xl">{formatDate(event.startsAt, timezone)}</span>} hint={<Link href={`/admin/manage/events/${event.id}`} className="text-brand-ink">Edit event</Link>} />
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchBox placeholder="Name, email or reference…" defaultValue={q} />
        <FilterSelect name="event" label="All events" value={sp.event} options={events.map((e) => ({ value: e.id, label: `${e.title} · ${formatDate(e.startsAt, timezone)}` }))} />
        <FilterSelect name="status" label="Any status" value={sp.status} options={STATUSES.map((s) => ({ value: s, label: s.toLowerCase() }))} />
      </div>
      {rows.length === 0 ? <EmptyState title="No registrations" /> : (
        <>
          <Table>
            <THead><tr><TH>Ref</TH><TH>Player</TH><TH>Event</TH><TH>Price</TH><TH>Registered</TH><TH>Status</TH><TH /></tr></THead>
            <tbody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="font-mono text-xs">{r.reference}</TD>
                  <TD><Link href={`/admin/users/${r.userId}`} className="hover:text-brand-ink">{r.user.name}</Link><div className="text-xs text-muted">{r.user.phone ?? r.user.email}</div></TD>
                  <TD>{r.event.title}</TD>
                  <TD className="font-mono text-xs">{r.price.greaterThan(0) ? formatMoney(r.price, r.currency) : "Free"}</TD>
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
