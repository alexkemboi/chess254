import Link from "next/link";
import { Crown } from "lucide-react";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { PageHeader, EmptyState, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { formatDate, formatMoney } from "@/lib/format";

export default async function MembershipPage() {
  const user = await requireUser("/dashboard/membership");
  const { timezone } = await getSettings("general");
  const now = new Date();
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { plan: { include: { entitlements: { include: { sessionType: true } } } }, payments: { include: { payment: true }, orderBy: { createdAt: "desc" } } },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div>
      <PageHeader eyebrow="Membership" title="Your membership" actions={<Button asChild variant="secondary"><Link href="/memberships">All plans</Link></Button>} />
      {memberships.length === 0 ? (
        <EmptyState icon={<Crown />} title="No membership yet" description="Pick a plan and pay with M-Pesa — it activates as soon as the payment is confirmed." action={<Button asChild><Link href="/memberships">Choose a membership</Link></Button>} />
      ) : (
        <div className="grid gap-5">
          {memberships.map((m) => {
            const live = m.status === "ACTIVE" && m.expiresAt && m.expiresAt > now;
            return (
              <div key={m.id} className="rounded-3xl border border-border bg-surface p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2"><h2 className="font-display text-2xl font-extrabold tracking-tight">{m.plan.name}</h2><StatusBadge status={live ? "ACTIVE" : m.status === "ACTIVE" ? "EXPIRED" : m.status} /></div>
                    <p className="mt-1 text-sm text-muted">{m.startsAt ? `Started ${formatDate(m.startsAt, timezone)}` : "Not started"}{m.expiresAt ? ` · ${live ? "renews / ends" : "ended"} ${formatDate(m.expiresAt, timezone)}` : ""}</p>
                    {m.plan.accessStartTime && <p className="mt-1 text-sm text-muted">Clubhouse access from {m.plan.accessStartTime}{m.plan.accessEndTime ? ` to ${m.plan.accessEndTime}` : " until close"}.</p>}
                    {live && m.plan.entitlements.length > 0 && (
                      <ul className="mt-3 text-sm">
                        {m.plan.entitlements.map((e) => <li key={e.id} className="text-brand">Includes {e.quantity} × {e.sessionType.name} per {e.period === "BILLING_PERIOD" ? "billing period" : e.period.toLowerCase()}</li>)}
                      </ul>
                    )}
                  </div>
                  {m.plan.status === "ACTIVE" && <Button asChild><Link href={`/join/${m.plan.slug}`}>{live ? "Renew early" : "Renew"}</Link></Button>}
                </div>
                {m.payments.length > 0 && (
                  <div className="mt-6">
                    <Table className="min-w-[520px]">
                      <THead><tr><TH>Period</TH><TH>Amount</TH><TH>Receipt</TH><TH>Paid</TH></tr></THead>
                      <tbody>
                        {m.payments.map((p) => (
                          <TR key={p.id}>
                            <TD>{formatDate(p.periodStart, timezone)} – {formatDate(p.periodEnd, timezone)}</TD>
                            <TD className="font-mono">{formatMoney(p.payment.amount, p.payment.currency)}</TD>
                            <TD className="font-mono text-xs">{p.payment.receiptNumber ?? "—"}</TD>
                            <TD>{p.payment.completedAt ? formatDate(p.payment.completedAt, timezone) : "—"}</TD>
                          </TR>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
