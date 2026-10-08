import { prisma } from "@/server/db";
import { nowMs } from "@/lib/time";
import { requirePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { describeSecrets } from "@/server/secrets";
import { PageHeader, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { BroadcastForm } from "@/components/admin/broadcast-form";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Notifications" };

export default async function AdminNotifications() {
  await requirePermission("notifications.manage", "/admin/notifications");
  const { timezone } = await getSettings("general");
  const [plans, deliveries, email, counts] = await Promise.all([
    prisma.membershipPlan.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true } }),
    prisma.notificationDelivery.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
    describeSecrets("email"),
    prisma.notificationDelivery.groupBy({ by: ["status"], where: { createdAt: { gte: new Date(nowMs() - 7 * 86400_000) } }, _count: { _all: true } }),
  ]);
  const smtpReady = email.filter((e) => e.key !== "smtp.port").every((e) => e.source !== "unset");
  return (
    <div className="grid gap-6">
      <PageHeader title="Notifications" description="Send announcements in-app (and by email). Transactional messages — bookings, payments, reminders — are sent automatically." />
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant={smtpReady ? "success" : "warning"}>Email {smtpReady ? "connected" : "not configured — emails are skipped"}</Badge>
        <Badge variant="neutral">SMS provider: not installed (pluggable)</Badge>
        {counts.map((c) => <Badge key={c.status} variant="neutral">{c.status.toLowerCase()} 7d: {c._count._all}</Badge>)}
      </div>
      <Card>
        <CardHeader><CardTitle>Broadcast</CardTitle></CardHeader>
        <CardContent><BroadcastForm plans={plans.map((p) => ({ value: p.id, label: p.name }))} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Recent outbound deliveries</CardTitle></CardHeader>
        <CardContent className="p-0">
          {deliveries.length ? (
            <Table className="rounded-none border-0">
              <THead><tr><TH>When</TH><TH>Channel</TH><TH>To</TH><TH>Subject</TH><TH>Status</TH></tr></THead>
              <tbody>
                {deliveries.map((d) => (
                  <TR key={d.id}><TD className="whitespace-nowrap text-muted">{formatDateTime(d.createdAt, timezone)}</TD><TD>{d.channel}</TD><TD className="font-mono text-xs">{d.recipient}</TD><TD>{d.subject}</TD><TD><StatusBadge status={d.status} />{d.error && <div className="mt-1 text-xs text-muted">{d.error}</div>}</TD></TR>
                ))}
              </tbody>
            </Table>
          ) : <p className="p-5 text-sm text-muted">Nothing sent yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
