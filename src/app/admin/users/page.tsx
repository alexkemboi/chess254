import Link from "next/link";
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { activeMembershipWhere } from "@/server/memberships";
import { PageHeader, EmptyState, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { FilterSelect, Pagination, SearchBox } from "@/components/admin/list-tools";
import { formatDate, humanize } from "@/lib/format";

export const metadata = { title: "Users" };
const ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "COACH", "MODERATOR", "MEMBER"];

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; membership?: string; status?: string; page?: string }> }) {
  await requirePermission("users.view", "/admin/users");
  const sp = await searchParams;
  const { timezone } = await getSettings("general");
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim().slice(0, 80);
  const now = new Date();
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } : {}),
    ...(ROLES.includes(sp.role as Role) ? { role: sp.role as Role } : {}),
    ...(sp.membership === "active" ? { memberships: { some: activeMembershipWhere(now) } } : sp.membership === "none" ? { memberships: { none: activeMembershipWhere(now) } } : {}),
    ...(sp.status === "suspended" ? { suspendedAt: { not: null } } : sp.status === "unverified" ? { emailVerifiedAt: null } : {}),
  };
  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 30, take: 30, include: { memberships: { where: activeMembershipWhere(now), include: { plan: { select: { name: true } } } } } }),
    prisma.user.count({ where }),
  ]);
  return (
    <div>
      <PageHeader title="Users & members" description="Search accounts, review memberships and manage access." />
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchBox placeholder="Name, email or phone…" defaultValue={q} />
        <FilterSelect name="role" label="All roles" value={sp.role} options={ROLES.map((r) => ({ value: r, label: humanize(r) }))} />
        <FilterSelect name="membership" label="Any membership" value={sp.membership} options={[{ value: "active", label: "Active membership" }, { value: "none", label: "No active membership" }]} />
        <FilterSelect name="status" label="Any status" value={sp.status} options={[{ value: "suspended", label: "Suspended" }, { value: "unverified", label: "Unverified email" }]} />
      </div>
      {users.length === 0 ? <EmptyState title="No users found" /> : (
        <>
          <Table>
            <THead><tr><TH>Name</TH><TH>Email</TH><TH>Role</TH><TH>Membership</TH><TH>Joined</TH><TH>Status</TH></tr></THead>
            <tbody>
              {users.map((u) => (
                <TR key={u.id}>
                  <TD><Link href={`/admin/users/${u.id}`} className="font-medium hover:text-brand">{u.name}</Link></TD>
                  <TD className="text-muted">{u.email}</TD>
                  <TD><Badge variant={u.role === "MEMBER" ? "neutral" : "default"}>{humanize(u.role)}</Badge></TD>
                  <TD>{u.memberships[0]?.plan.name ?? <span className="text-muted">—</span>}</TD>
                  <TD className="text-muted">{formatDate(u.createdAt, timezone)}</TD>
                  <TD>{u.suspendedAt ? <Badge variant="danger">Suspended</Badge> : !u.emailVerifiedAt ? <Badge variant="warning">Unverified</Badge> : <Badge variant="success">Active</Badge>}</TD>
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
