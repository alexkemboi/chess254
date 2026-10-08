import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { requirePermission } from "@/server/auth";
import { PAGE_SIZE, RESOURCES, type Cell } from "@/server/admin/resources";
import { PageHeader, EmptyState, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { MoveButtons } from "@/components/admin/resource-ui";
import { Img } from "@/components/ui/img";
import { Pagination, SearchBox } from "@/components/admin/list-tools";

export async function generateMetadata({ params }: { params: Promise<{ resource: string }> }) {
  return { title: RESOURCES[(await params).resource]?.title ?? "Admin" };
}

function renderCell(cell: Cell) {
  if (typeof cell === "string") return cell;
  if (cell.badge) return <StatusBadge status={cell.text} />;
  if (cell.image) return <span className="relative block size-12 overflow-hidden rounded-lg bg-surface-2"><Img src={cell.image} alt="" fill sizes="48px" className="object-cover" /></span>;
  return <span className={cell.mono ? "font-mono text-xs" : cell.muted ? "text-muted" : ""}>{cell.text}</span>;
}

export default async function ResourceList({ params, searchParams }: { params: Promise<{ resource: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const { resource } = await params;
  const r = RESOURCES[resource];
  if (!r) notFound();
  await requirePermission(r.permission, `/admin/manage/${resource}`);
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 80) ?? "";
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total } = await r.list(q, page);
  return (
    <div>
      <PageHeader title={r.title} description={r.description} actions={<Button asChild><Link href={`/admin/manage/${resource}/new`}><Plus />New {r.singular}</Link></Button>} />
      <div className="mb-4"><SearchBox placeholder={`Search ${r.title.toLowerCase()}…`} defaultValue={q} /></div>
      {rows.length === 0 ? (
        <EmptyState title={q ? "No matches" : `No ${r.title.toLowerCase()} yet`} description={q ? "Try another search." : `Create the first ${r.singular}.`} action={!q ? <Button asChild><Link href={`/admin/manage/${resource}/new`}><Plus />New {r.singular}</Link></Button> : undefined} />
      ) : (
        <>
          <Table>
            <THead><tr>{r.columns.map((c) => <TH key={c}>{c}</TH>)}<TH className="w-1" /></tr></THead>
            <tbody>
              {rows.map((row) => (
                <TR key={row.id}>
                  {row.cells.map((cell, i) => (
                    <TD key={i} className={i === 0 ? "font-medium" : ""}>
                      {i === 0 && typeof cell === "string" ? <Link href={`/admin/manage/${resource}/${row.id}`} className="hover:text-brand">{cell}</Link> : renderCell(cell)}
                    </TD>
                  ))}
                  <TD className="whitespace-nowrap text-right">
                    {r.move && !q && <MoveButtons resource={resource} id={row.id} />}
                    <Button asChild size="sm" variant="ghost"><Link href={`/admin/manage/${resource}/${row.id}`}>Edit</Link></Button>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} total={total} pageSize={PAGE_SIZE} />
        </>
      )}
    </div>
  );
}
