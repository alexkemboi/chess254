import Link from "next/link";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { PageHeader, EmptyState, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { Pagination, SearchBox } from "@/components/admin/list-tools";
import { formatDateTime, formatMoney } from "@/lib/format";

export const metadata = { title: "Invoices" };

export default async function Invoices({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requirePermission("payments.view", "/admin/invoices");
  const sp = await searchParams;
  const { timezone } = await getSettings("general");
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim().toUpperCase().slice(0, 40);
  const where = q ? { OR: [{ number: { contains: q } }, { order: { number: { contains: q } } }] } : {};
  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({ where, include: { order: { include: { user: { select: { name: true } } } }, payment: { select: { receiptNumber: true } } }, orderBy: { issuedAt: "desc" }, skip: (page - 1) * 30, take: 30 }),
    prisma.invoice.count({ where }),
  ]);
  return (
    <div>
      <PageHeader title="Invoices" description="Issued automatically for every confirmed payment." />
      <div className="mb-4"><SearchBox placeholder="Invoice or order number…" defaultValue={sp.q} /></div>
      {rows.length === 0 ? <EmptyState title="No invoices yet" description="Invoices appear once payments are confirmed." /> : (
        <>
          <Table>
            <THead><tr><TH>Invoice</TH><TH>Issued</TH><TH>Member</TH><TH>Order</TH><TH>Total</TH><TH>M-Pesa</TH></tr></THead>
            <tbody>
              {rows.map((i) => (
                <TR key={i.id}>
                  <TD><Link href={`/invoices/${i.number}`} className="font-mono text-xs hover:text-brand-ink">{i.number}</Link></TD>
                  <TD className="text-muted">{formatDateTime(i.issuedAt, timezone)}</TD>
                  <TD>{i.order.user.name}</TD>
                  <TD className="font-mono text-xs">{i.order.number}</TD>
                  <TD className="font-mono">{formatMoney(i.total, i.currency)}</TD>
                  <TD className="font-mono text-xs">{i.payment?.receiptNumber ?? "—"}</TD>
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
