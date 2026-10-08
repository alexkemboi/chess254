import Link from "next/link";
import { Ticket } from "lucide-react";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";

export default async function PassesPage() {
  const user = await requireUser("/dashboard/passes");
  const { timezone } = await getSettings("general");
  const passes = await prisma.servicePurchase.findMany({ where: { userId: user.id, status: { in: ["ACTIVE", "REDEEMED", "EXPIRED"] } }, include: { service: true }, orderBy: { createdAt: "desc" }, take: 50 });
  return (
    <div>
      <PageHeader eyebrow="Visits" title="Passes" description="Show the code at the front desk when you arrive." actions={<Button asChild variant="secondary"><Link href="/memberships">Buy a pass</Link></Button>} />
      {passes.length === 0 ? (
        <EmptyState icon={<Ticket />} title="No passes" description="Day passes you buy will appear here with their check-in code." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {passes.map((p) => (
            <div key={p.id} className="relative overflow-hidden rounded-3xl border border-border bg-surface p-6">
              <div className="pointer-events-none absolute -right-4 -top-6 font-display text-8xl text-brand/10">♟</div>
              <div className="flex items-center justify-between"><span className="font-semibold">{p.service.name}</span><StatusBadge status={p.status} /></div>
              <div className="mt-4 font-mono text-3xl font-bold tracking-widest text-brand">{p.code}</div>
              {p.validUntil && <div className="mt-2 text-sm text-muted">{p.status === "ACTIVE" ? "Valid until" : "Expired"} {formatDateTime(p.validUntil, timezone)}</div>}
              {p.redeemedAt && <div className="mt-1 text-sm text-muted">Used {formatDateTime(p.redeemedAt, timezone)}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
