import Link from "next/link";
import { Download } from "lucide-react";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { bookingWhere } from "@/server/admin/queries";
import { PageHeader, EmptyState, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { DateFilter, FilterSelect, Pagination, SearchBox } from "@/components/admin/list-tools";
import { FormDialog } from "@/components/admin/admin-ui";
import { adminCancelBookingAction, adminRescheduleBookingAction } from "@/actions/admin";
import { dateKeyInZone } from "@/lib/time";
import { formatDateTime, formatMoney } from "@/lib/format";

const clock24 = (d: Date, tz: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(d);

export const metadata = { title: "Bookings" };

export default async function AdminBookings({ searchParams }: { searchParams: Promise<{ coach?: string; member?: string; status?: string; from?: string; to?: string; page?: string }> }) {
  await requirePermission("bookings.manage", "/admin/bookings");
  const sp = await searchParams;
  const { timezone } = await getSettings("general");
  const page = Math.max(1, Number(sp.page) || 1);
  const where = bookingWhere(sp, timezone);
  const [rows, total, coaches] = await Promise.all([
    prisma.booking.findMany({ where, include: { member: true, coach: { include: { user: { select: { name: true } } } }, sessionType: { include: { coaches: { include: { user: { select: { name: true } } } } } }, orderItem: { include: { order: true } } }, orderBy: { startsAt: "desc" }, skip: (page - 1) * 30, take: 30 }),
    prisma.booking.count({ where }),
    prisma.coachProfile.findMany({ include: { user: { select: { name: true } } }, orderBy: { position: "asc" } }),
  ]);
  const exportQuery = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "page" && v) as [string, string][]);
  return (
    <div>
      <PageHeader title="Bookings" description="Every coaching booking. Filter, cancel, reschedule or export." actions={<Button asChild variant="secondary"><a href={`/admin/export/bookings?${exportQuery}`}><Download />Export CSV</a></Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBox name="member" placeholder="Member name or email…" defaultValue={sp.member} />
        <FilterSelect name="coach" label="All coaches" value={sp.coach} options={coaches.map((c) => ({ value: c.id, label: c.user.name }))} />
        <FilterSelect name="status" label="Any status" value={sp.status} options={["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED", "EXPIRED"].map((s) => ({ value: s, label: s.toLowerCase().replace("_", " ") }))} />
        <DateFilter name="from" label="From" value={sp.from} />
        <DateFilter name="to" label="To" value={sp.to} />
      </div>
      {rows.length === 0 ? <EmptyState title="No bookings match" /> : (
        <>
          <Table>
            <THead><tr><TH>Ref</TH><TH>Member</TH><TH>Session</TH><TH>Coach</TH><TH>When</TH><TH>Price</TH><TH>Status</TH><TH /></tr></THead>
            <tbody>
              {rows.map((b) => {
                const active = b.status === "CONFIRMED" || b.status === "PENDING";
                return (
                  <TR key={b.id}>
                    <TD className="font-mono text-xs">{b.reference}</TD>
                    <TD><Link href={`/admin/users/${b.memberId}`} className="hover:text-brand">{b.member.name}</Link></TD>
                    <TD>{b.sessionType.name}</TD>
                    <TD>{b.coach.user.name}</TD>
                    <TD className="whitespace-nowrap">{formatDateTime(b.startsAt, timezone)}</TD>
                    <TD className="font-mono text-xs">{b.usedEntitlement ? <Badge>Included</Badge> : b.price.greaterThan(0) ? `${formatMoney(b.price, b.currency)}${b.orderItem?.order.status === "PAID" ? " ✓" : ""}` : "Free"}</TD>
                    <TD><StatusBadge status={b.status} /></TD>
                    <TD className="whitespace-nowrap text-right">
                      {active && (
                        <span className="inline-flex gap-1">
                          <FormDialog trigger="Reschedule" title={`Reschedule ${b.reference}`} description="The new time must be free for the coach and the member. The member is notified." action={adminRescheduleBookingAction.bind(null, b.id)} submitLabel="Move booking" variant="ghost">
                            <div className="grid grid-cols-2 gap-3">
                              <div className="grid gap-1.5"><Label htmlFor={`d-${b.id}`}>Date</Label><Input id={`d-${b.id}`} type="date" name="date" defaultValue={dateKeyInZone(b.startsAt, timezone)} required /></div>
                              <div className="grid gap-1.5"><Label htmlFor={`t-${b.id}`}>Time</Label><Input id={`t-${b.id}`} type="time" name="time" defaultValue={clock24(b.startsAt, timezone)} required /></div>
                            </div>
                            <div className="grid gap-1.5"><Label htmlFor={`c-${b.id}`}>Coach</Label><Select id={`c-${b.id}`} name="coachId" defaultValue={b.coachId}>{b.sessionType.coaches.map((c) => <option key={c.id} value={c.id}>{c.user.name}</option>)}</Select></div>
                          </FormDialog>
                          <FormDialog trigger="Cancel" title={`Cancel ${b.reference}`} description={b.orderItem?.order.status === "PAID" ? "This booking was paid. Cancelling will flag a refund." : "The member is notified."} action={adminCancelBookingAction.bind(null, b.id)} submitLabel="Cancel booking" variant="ghost" submitVariant="danger">
                            <Label htmlFor={`r-${b.id}`}>Reason</Label><Textarea id={`r-${b.id}`} name="reason" required />
                          </FormDialog>
                        </span>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
          <Pagination page={page} total={total} pageSize={30} />
        </>
      )}
    </div>
  );
}
