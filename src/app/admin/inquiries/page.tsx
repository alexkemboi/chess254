import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/badge";
import { ActionButton } from "@/components/admin/admin-ui";
import { FilterSelect } from "@/components/admin/list-tools";
import { markInquiryHandledAction } from "@/actions/admin";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Contact messages" };

export default async function Inquiries({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requirePermission("cms.manage", "/admin/inquiries");
  const { show } = await searchParams;
  const { timezone } = await getSettings("general");
  const rows = await prisma.contactInquiry.findMany({ where: show === "all" ? {} : { handledAt: null }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <div>
      <PageHeader title="Contact messages" description="Messages sent from the contact page." actions={<FilterSelect name="show" label="Open only" value={show} options={[{ value: "all", label: "All messages" }]} />} />
      {rows.length === 0 ? <EmptyState title="No messages" description="New contact-form messages appear here." /> : (
        <div className="grid gap-3">
          {rows.map((m) => (
            <div key={m.id} className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{m.subject}</span>
                <StatusBadge status={m.handledAt ? "RESOLVED" : "OPEN"} />
                <span className="ml-auto text-xs text-muted">{formatDateTime(m.createdAt, timezone)}</span>
              </div>
              <div className="mt-1 text-sm text-muted">{m.name} · <a href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.subject}`)}`} className="text-brand">{m.email}</a>{m.phone && <> · <a href={`tel:${m.phone}`} className="text-brand">{m.phone}</a></>}</div>
              <p className="mt-3 whitespace-pre-line text-sm">{m.message}</p>
              {!m.handledAt && <div className="mt-4"><ActionButton action={markInquiryHandledAction.bind(null, m.id)}>Mark handled</ActionButton></div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
