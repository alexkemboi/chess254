import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { PageHeader, EmptyState, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { FilterSelect, Pagination, SearchBox } from "@/components/admin/list-tools";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; entity?: string; page?: string }> }) {
  await requirePermission("audit.view", "/admin/audit");
  const sp = await searchParams;
  const { timezone } = await getSettings("general");
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim().slice(0, 80);
  const where: Prisma.AuditLogWhereInput = {
    ...(sp.entity ? { entity: sp.entity } : {}),
    ...(q ? { OR: [{ action: { contains: q, mode: "insensitive" } }, { entityId: { contains: q } }, { actor: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, entities] = await Promise.all([
    prisma.auditLog.findMany({ where, include: { actor: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50 }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ distinct: ["entity"], select: { entity: true }, orderBy: { entity: "asc" } }),
  ]);
  return (
    <div>
      <PageHeader title="Audit log" description="Who changed what, when and from where. Secrets are redacted before they're stored." />
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchBox placeholder="Action, actor or entity id…" defaultValue={q} />
        <FilterSelect name="entity" label="All entities" value={sp.entity} options={entities.map((e) => ({ value: e.entity, label: e.entity }))} />
      </div>
      {rows.length === 0 ? <EmptyState title="No entries" /> : (
        <>
          <Table>
            <THead><tr><TH>When</TH><TH>Actor</TH><TH>Action</TH><TH>Entity</TH><TH>IP</TH><TH>Change</TH></tr></THead>
            <tbody>
              {rows.map((a) => (
                <TR key={a.id}>
                  <TD className="whitespace-nowrap text-muted">{formatDateTime(a.createdAt, timezone)}</TD>
                  <TD>{a.actor?.name ?? <span className="text-muted">System</span>}</TD>
                  <TD className="font-mono text-xs">{a.action}</TD>
                  <TD className="font-mono text-xs">{a.entity}{a.entityId ? ` · ${a.entityId.slice(0, 24)}` : ""}</TD>
                  <TD className="font-mono text-xs text-muted">{a.ipAddress}</TD>
                  <TD>
                    {(a.previous || a.next) ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-brand">View</summary>
                        <div className="mt-2 grid max-w-xl gap-2">
                          {a.previous && <pre className="overflow-x-auto rounded-lg bg-danger/5 p-2 font-mono text-[11px]">{JSON.stringify(a.previous, null, 1)}</pre>}
                          {a.next && <pre className="overflow-x-auto rounded-lg bg-success/5 p-2 font-mono text-[11px]">{JSON.stringify(a.next, null, 1)}</pre>}
                        </div>
                      </details>
                    ) : "—"}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} total={total} pageSize={50} />
        </>
      )}
    </div>
  );
}
