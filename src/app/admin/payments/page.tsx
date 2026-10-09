import Link from "next/link";
import { Download } from "lucide-react";
import type { PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { can } from "@/server/rbac";
import { getSettings } from "@/server/settings";
import { PageHeader, EmptyState, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/admin/admin-ui";
import { FilterSelect, Pagination, SearchBox } from "@/components/admin/list-tools";
import { runMaintenanceAction } from "@/actions/admin";
import { formatDateTime, formatMoney } from "@/lib/format";

export const metadata = { title: "Payments" };
const STATUSES: PaymentStatus[] = ["PENDING", "PROCESSING", "SUCCESS", "FAILED", "CANCELLED", "REFUNDED", "EXPIRED"];

export default async function AdminPayments({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const actor = await requirePermission("payments.view", "/admin/payments");
  const sp = await searchParams;
  const { timezone } = await getSettings("general");
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim().slice(0, 80);
  const where: Prisma.PaymentWhereInput = {
    ...(STATUSES.includes(sp.status as PaymentStatus) ? { status: sp.status as PaymentStatus } : {}),
    ...(q ? { OR: [{ receiptNumber: { contains: q.toUpperCase() } }, { phoneNumber: { contains: q } }, { checkoutRequestId: { contains: q } }, { order: { number: { contains: q.toUpperCase() } } }, { user: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, canReconcile, canExport] = await Promise.all([
    prisma.payment.findMany({ where, include: { user: { select: { name: true } }, order: { select: { number: true } }, provider: { select: { name: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 30, take: 30 }),
    prisma.payment.count({ where }),
    can(actor.role, "payments.reconcile"),
    can(actor.role, "reports.view"),
  ]);
  return (
    <div>
      <PageHeader
        title="Payments"
        description="Every M-Pesa attempt with its provider reference. Successful payments are only recorded after Safaricom confirms them."
        actions={
          <>
            {canReconcile && <ActionButton action={runMaintenanceAction}>Run reconciliation now</ActionButton>}
            {canExport && <Button asChild variant="secondary" size="sm"><a href={`/admin/export/payments${sp.status ? `?status=${sp.status}` : ""}`}><Download />Export CSV</a></Button>}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchBox placeholder="Receipt, phone, order or member…" defaultValue={q} />
        <FilterSelect name="status" label="Any status" value={sp.status} options={STATUSES.map((s) => ({ value: s, label: s.toLowerCase() }))} />
      </div>
      {rows.length === 0 ? <EmptyState title="No payments" /> : (
        <>
          <Table>
            <THead><tr><TH>Created</TH><TH>Member</TH><TH>Order</TH><TH>Phone</TH><TH>Amount</TH><TH>Receipt</TH><TH>Status</TH></tr></THead>
            <tbody>
              {rows.map((p) => (
                <TR key={p.id}>
                  <TD className="whitespace-nowrap text-muted"><Link href={`/admin/payments/${p.id}`} className="hover:text-brand-ink">{formatDateTime(p.createdAt, timezone)}</Link></TD>
                  <TD>{p.user.name}</TD>
                  <TD className="font-mono text-xs">{p.order.number}</TD>
                  <TD className="font-mono text-xs">{p.phoneNumber}</TD>
                  <TD className="font-mono">{formatMoney(p.amount, p.currency)}</TD>
                  <TD className="font-mono text-xs">{p.receiptNumber ?? "—"}</TD>
                  <TD><StatusBadge status={p.status} />{p.failureReason && p.status !== "SUCCESS" && <div className="mt-1 max-w-48 truncate text-xs text-muted" title={p.failureReason}>{p.failureReason}</div>}</TD>
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
