import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { PageHeader, EmptyState, Stat, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterSelect, Pagination, SearchBox } from "@/components/admin/list-tools";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Memberships" };

export default async function AdminMemberships({ searchParams }: { searchParams: Promise<{ q?: string; plan?: string; status?: string; page?: string }> }) {
  await requirePermission("memberships.manage", "/admin/memberships");
  const sp = await searchParams;
  const { timezone } = await getSettings("general");
  const page = Math.max(1, Number(sp.page) || 1);
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86400_000);
  const q = sp.q?.trim().slice(0, 80);
  const statusWhere: Prisma.MembershipWhereInput =
    sp.status === "active" ? { status: "ACTIVE", expiresAt: { gt: now } } :
    sp.status === "expiring" ? { status: "ACTIVE", expiresAt: { gt: now, lte: soon } } :
    sp.status === "expired" ? { OR: [{ status: "EXPIRED" }, { status: "ACTIVE", expiresAt: { lte: now } }] } :
    sp.status === "cancelled" ? { status: "CANCELLED" } : {};
  const where: Prisma.MembershipWhereInput = { ...statusWhere, ...(sp.plan ? { planId: sp.plan } : {}), ...(q ? { user: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } } : {}) };
  const [rows, total, plans, active, expiring, expired] = await Promise.all([
    prisma.membership.findMany({ where, include: { user: true, plan: true, _count: { select: { payments: true } } }, orderBy: { expiresAt: "desc" }, skip: (page - 1) * 30, take: 30 }),
    prisma.membership.count({ where }),
    prisma.membershipPlan.findMany({ orderBy: { priority: "asc" } }),
    prisma.membership.count({ where: { status: "ACTIVE", expiresAt: { gt: now } } }),
    prisma.membership.count({ where: { status: "ACTIVE", expiresAt: { gt: now, lte: soon } } }),
    prisma.membership.count({ where: { OR: [{ status: "EXPIRED" }, { status: "ACTIVE", expiresAt: { lte: now } }] } }),
  ]);
  return (
    <div>
      <PageHeader title="Memberships" description="Every member's plan, period and payments. Open a member to extend, cancel or grant." actions={<Button asChild variant="secondary"><Link href="/admin/manage/plans">Edit plans</Link></Button>} />
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="Active" value={active} />
        <Stat label="Expiring in 7 days" value={expiring} />
        <Stat label="Expired" value={expired} />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchBox placeholder="Member name or email…" defaultValue={q} />
        <FilterSelect name="plan" label="All plans" value={sp.plan} options={plans.map((p) => ({ value: p.id, label: p.name }))} />
        <FilterSelect name="status" label="Any status" value={sp.status} options={[{ value: "active", label: "Active" }, { value: "expiring", label: "Expiring soon" }, { value: "expired", label: "Expired" }, { value: "cancelled", label: "Cancelled" }]} />
      </div>
      {rows.length === 0 ? <EmptyState title="No memberships match" /> : (
        <>
          <Table>
            <THead><tr><TH>Member</TH><TH>Plan</TH><TH>Started</TH><TH>Expires</TH><TH>Payments</TH><TH>Status</TH></tr></THead>
            <tbody>
              {rows.map((m) => {
                const live = m.status === "ACTIVE" && m.expiresAt && m.expiresAt > now;
                return (
                  <TR key={m.id}>
                    <TD><Link href={`/admin/users/${m.userId}`} className="font-medium hover:text-brand-ink">{m.user.name}</Link><div className="text-xs text-muted">{m.user.email}</div></TD>
                    <TD>{m.plan.name}</TD>
                    <TD>{m.startsAt ? formatDate(m.startsAt, timezone) : "—"}</TD>
                    <TD>{m.expiresAt ? formatDate(m.expiresAt, timezone) : "—"}</TD>
                    <TD>{m._count.payments || <span className="text-muted">comp</span>}</TD>
                    <TD><StatusBadge status={live ? "ACTIVE" : m.status === "ACTIVE" ? "EXPIRED" : m.status} /></TD>
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
