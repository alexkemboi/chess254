import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { can } from "@/server/rbac";
import { getSettings } from "@/server/settings";
import { PageHeader, Stat, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Input, Select, Textarea, Label } from "@/components/ui/input";
import { ActionButton, FormDialog } from "@/components/admin/admin-ui";
import { adjustMembershipAction, assignCoachAction, changeRoleAction, grantMembershipAction, suspendUserAction, verifyUserEmailAction } from "@/actions/admin";
import { formatDate, formatDateTime, formatMoney, humanize } from "@/lib/format";

export const metadata = { title: "User" };
const ROLES = ["SUPER_ADMIN", "ADMIN", "COACH", "MODERATOR", "MEMBER"];

export default async function UserDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("users.view", `/admin/users/${id}`);
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    include: {
      memberProfile: true,
      coachProfile: true,
      memberships: { include: { plan: true }, orderBy: { createdAt: "desc" } },
      bookings: { include: { sessionType: true, coach: { include: { user: { select: { name: true } } } } }, orderBy: { startsAt: "desc" }, take: 10 },
      payments: { orderBy: { createdAt: "desc" }, take: 10 },
      coachLinks: { include: { coach: { include: { user: { select: { name: true } } } } } },
      _count: { select: { posts: true, comments: true, learningProgress: true, puzzleAttempts: true, eventRegistrations: true } },
    },
  });
  if (!user) notFound();
  const { timezone } = await getSettings("general");
  const [canRoles, canManage, canMemberships, canCoaches, plans, coaches] = await Promise.all([
    can(actor.role, "roles.manage"),
    can(actor.role, "users.manage"),
    can(actor.role, "memberships.manage"),
    can(actor.role, "coaches.manage"),
    prisma.membershipPlan.findMany({ where: { status: { in: ["ACTIVE", "INACTIVE"] } }, orderBy: { priority: "asc" } }),
    prisma.coachProfile.findMany({ where: { isActive: true }, include: { user: { select: { name: true } } } }),
  ]);
  const now = new Date();
  return (
    <div className="grid gap-6">
      <Link href="/admin/users" className="text-sm text-muted hover:text-foreground">← Users</Link>
      <PageHeader
        title={user.name}
        description={`${user.email}${user.phone ? ` · ${user.phone}` : ""} · joined ${formatDate(user.createdAt, timezone)}`}
        actions={
          <>
            <Badge>{humanize(user.role)}</Badge>
            {user.suspendedAt && <Badge variant="danger">Suspended{user.suspensionReason ? `: ${user.suspensionReason}` : ""}</Badge>}
            {!user.emailVerifiedAt && canManage && <ActionButton action={verifyUserEmailAction.bind(null, user.id)}>Mark email verified</ActionButton>}
            {canRoles && (
              <FormDialog trigger="Change role" title="Change role" action={changeRoleAction.bind(null, user.id)} submitLabel="Save role">
                <Select name="role" defaultValue={user.role}>{ROLES.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</Select>
              </FormDialog>
            )}
            {canManage && (
              user.suspendedAt ? (
                <FormDialog trigger="Reinstate" title="Reinstate user" action={suspendUserAction.bind(null, user.id)} submitLabel="Reinstate"><input type="hidden" name="suspend" value="false" /><p className="text-sm text-muted">They’ll be able to sign in again.</p></FormDialog>
              ) : (
                <FormDialog trigger="Suspend" title="Suspend user" description="They are signed out everywhere and can't sign in." action={suspendUserAction.bind(null, user.id)} submitLabel="Suspend" variant="danger" submitVariant="danger">
                  <input type="hidden" name="suspend" value="true" />
                  <Label htmlFor="reason">Reason</Label><Textarea id="reason" name="reason" />
                </FormDialog>
              )
            )}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Lessons" value={user._count.learningProgress} />
        <Stat label="Puzzle attempts" value={user._count.puzzleAttempts} hint={`Rating ${user.memberProfile?.puzzleRating ?? "—"}`} />
        <Stat label="Events" value={user._count.eventRegistrations} />
        <Stat label="Posts" value={user._count.posts} />
        <Stat label="Comments" value={user._count.comments} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Memberships</CardTitle>
            {canMemberships && plans.length > 0 && (
              <FormDialog trigger="Grant membership" title="Grant a complimentary membership" description="Activates or extends one billing period without a payment. Audited." action={grantMembershipAction.bind(null, user.id)} submitLabel="Grant">
                <Select name="planId">{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
                <Label htmlFor="note">Reason</Label><Input id="note" name="note" required />
              </FormDialog>
            )}
          </CardHeader>
          <CardContent className="grid gap-3">
            {user.memberships.length ? user.memberships.map((m) => {
              const live = m.status === "ACTIVE" && m.expiresAt && m.expiresAt > now;
              return (
                <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2 p-4">
                  <div>
                    <div className="flex items-center gap-2 font-semibold">{m.plan.name}<StatusBadge status={live ? "ACTIVE" : m.status === "ACTIVE" ? "EXPIRED" : m.status} /></div>
                    <div className="text-xs text-muted">{m.startsAt ? formatDate(m.startsAt, timezone) : "—"} → {m.expiresAt ? formatDate(m.expiresAt, timezone) : "—"}</div>
                  </div>
                  {canMemberships && m.status !== "CANCELLED" && (
                    <div className="flex gap-2">
                      <FormDialog trigger="Extend" title="Extend membership" action={adjustMembershipAction.bind(null, m.id)} submitLabel="Extend">
                        <input type="hidden" name="op" value="extend" />
                        <Label htmlFor="days">Days</Label><Input id="days" name="days" type="number" min={1} max={366} required />
                        <Label htmlFor="note-e">Reason</Label><Input id="note-e" name="note" required />
                      </FormDialog>
                      {live && (
                        <FormDialog trigger="Cancel" title="Cancel membership" action={adjustMembershipAction.bind(null, m.id)} submitLabel="Cancel membership" variant="ghost" submitVariant="danger">
                          <input type="hidden" name="op" value="cancel" />
                          <Label htmlFor="note-c">Reason (sent to the member)</Label><Input id="note-c" name="note" required />
                        </FormDialog>
                      )}
                    </div>
                  )}
                </div>
              );
            }) : <p className="text-sm text-muted">No memberships.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Coaches</CardTitle>
            {canCoaches && coaches.length > 0 && (
              <FormDialog trigger="Assign coach" title="Assign a coach" action={assignCoachAction.bind(null, user.id)} submitLabel="Assign">
                <Select name="coachId">{coaches.map((c) => <option key={c.id} value={c.id}>{c.user.name}</option>)}</Select>
              </FormDialog>
            )}
          </CardHeader>
          <CardContent className="grid gap-2">
            {user.coachLinks.length ? user.coachLinks.map((l) => (
              <div key={l.coachId} className="flex items-center justify-between rounded-xl bg-surface-2 p-3 text-sm">
                {l.coach.user.name}
                {canCoaches && <FormDialog trigger="Remove" title="Unassign coach" action={assignCoachAction.bind(null, user.id)} submitLabel="Unassign" variant="ghost"><input type="hidden" name="coachId" value={l.coachId} /><input type="hidden" name="remove" value="true" /><p className="text-sm text-muted">Remove {l.coach.user.name} as this member’s coach?</p></FormDialog>}
              </div>
            )) : <p className="text-sm text-muted">No assigned coach.</p>}
            {user.coachProfile && <p className="text-sm">This user is a coach · <Link href={`/admin/manage/coaches/${user.coachProfile.id}`} className="text-brand-ink">Edit profile</Link></p>}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Recent bookings</CardTitle></CardHeader>
        <CardContent className="p-0">
          {user.bookings.length ? (
            <Table className="rounded-none border-0">
              <THead><tr><TH>Session</TH><TH>Coach</TH><TH>When</TH><TH>Status</TH></tr></THead>
              <tbody>{user.bookings.map((b) => <TR key={b.id}><TD>{b.sessionType.name}</TD><TD>{b.coach.user.name}</TD><TD>{formatDateTime(b.startsAt, timezone)}</TD><TD><StatusBadge status={b.status} /></TD></TR>)}</tbody>
            </Table>
          ) : <p className="p-5 text-sm text-muted">No bookings.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Recent payments</CardTitle></CardHeader>
        <CardContent className="p-0">
          {user.payments.length ? (
            <Table className="rounded-none border-0">
              <THead><tr><TH>Amount</TH><TH>Status</TH><TH>Receipt</TH><TH>When</TH></tr></THead>
              <tbody>{user.payments.map((p) => <TR key={p.id}><TD className="font-mono"><Link href={`/admin/payments/${p.id}`} className="hover:text-brand-ink">{formatMoney(p.amount, p.currency)}</Link></TD><TD><StatusBadge status={p.status} /></TD><TD className="font-mono text-xs">{p.receiptNumber ?? "—"}</TD><TD>{formatDateTime(p.createdAt, timezone)}</TD></TR>)}</tbody>
            </Table>
          ) : <p className="p-5 text-sm text-muted">No payments.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
