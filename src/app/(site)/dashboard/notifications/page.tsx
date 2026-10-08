import Link from "next/link";
import { Bell } from "lucide-react";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { MarkAllReadButton, NotificationLink } from "@/components/site/notification-ui";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireUser("/dashboard/notifications");
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const [items, unread, total] = await Promise.all([
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 30, take: 30 }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    prisma.notification.count({ where: { userId: user.id } }),
  ]);
  return (
    <div>
      <PageHeader eyebrow="Inbox" title="Notifications" description={`${unread} unread`} actions={unread > 0 ? <MarkAllReadButton /> : undefined} />
      {items.length === 0 ? (
        <EmptyState icon={<Bell />} title="No notifications" description="Booking confirmations, payments and replies will show up here." />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {items.map((n) => (
            <li key={n.id}>
              <NotificationLink id={n.id} href={n.link} unread={!n.readAt}>
                <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", n.readAt ? "bg-surface-3" : "bg-brand")} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{n.title}</div>
                  <div className="text-sm text-muted">{n.body}</div>
                </div>
                <span className="shrink-0 text-xs text-muted">{relativeTime(n.createdAt)}</span>
              </NotificationLink>
            </li>
          ))}
        </ul>
      )}
      {total > page * 30 && <Link href={`/dashboard/notifications?page=${page + 1}`} className="mt-4 inline-block text-sm text-brand">Older →</Link>}
    </div>
  );
}
