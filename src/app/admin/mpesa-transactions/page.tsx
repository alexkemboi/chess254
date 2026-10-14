import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { can } from "@/server/rbac";
import { getSettings } from "@/server/settings";
import { pullStatus } from "@/server/payments/mpesa-pull";
import { PageHeader, EmptyState, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { FormDialog } from "@/components/admin/admin-ui";
import { FilterSelect, Pagination, SearchBox } from "@/components/admin/list-tools";
import { ignoreMpesaTransactionAction, linkMpesaTransactionAction, pullMpesaTransactionsAction } from "@/actions/admin";
import { formatDateTime, formatMoney } from "@/lib/format";

export const metadata = { title: "M-Pesa transactions" };
const STATUSES = ["UNMATCHED", "SETTLED", "MATCHED", "IGNORED"] as const;
const VARIANT: Record<string, "success" | "warning" | "neutral"> = { SETTLED: "success", MATCHED: "success", UNMATCHED: "warning", IGNORED: "neutral" };
const LABEL: Record<string, string> = { SETTLED: "settled order", MATCHED: "linked", UNMATCHED: "unmatched", IGNORED: "ignored" };

export default async function MpesaTransactions({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const actor = await requirePermission("payments.view", "/admin/mpesa-transactions");
  const sp = await searchParams;
  const { timezone, currency } = await getSettings("general");
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim().slice(0, 80);
  const where: Prisma.MpesaTransactionWhereInput = {
    ...(STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? { matchStatus: sp.status } : {}),
    ...(q ? { OR: [{ transactionId: { contains: q.toUpperCase() } }, { billReference: { contains: q, mode: "insensitive" } }, { msisdn: { contains: q } }, { sender: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total, unmatched, canReconcile, pull] = await Promise.all([
    prisma.mpesaTransaction.findMany({ where, include: { payment: { select: { id: true, order: { select: { number: true } } } } }, orderBy: { transactionDate: "desc" }, skip: (page - 1) * 30, take: 30 }),
    prisma.mpesaTransaction.count({ where }),
    prisma.mpesaTransaction.count({ where: { matchStatus: "UNMATCHED" } }),
    can(actor.role, "payments.reconcile"),
    pullStatus(),
  ]);
  return (
    <div>
      <PageHeader
        title="M-Pesa transactions"
        description="Payments received on the shortcode, read from Safaricom with the Pull Transactions API. Matching orders are settled automatically by account reference and amount."
        actions={
          canReconcile && (
            <FormDialog trigger="Pull from M-Pesa" title="Pull transactions" description="Reads received payments from Safaricom and settles any matching unpaid orders." action={pullMpesaTransactionsAction} submitLabel="Pull now">
              <Label htmlFor="hours">Look back</Label>
              <Select id="hours" name="hours" defaultValue="48">
                <option value="1">Last hour</option>
                <option value="6">Last 6 hours</option>
                <option value="24">Last 24 hours</option>
                <option value="48">Last 48 hours (maximum)</option>
              </Select>
            </FormDialog>
          )
        }
      />
      {!pull.active && (
        <div className="mb-4 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
          Automatic pulling is off. Enable it and register the shortcode in <Link href="/admin/payment-settings" className="text-brand-ink underline">Payment settings</Link>.
          {pull.config?.pullLastSyncedAt && <span className="text-muted"> Last pull {formatDateTime(pull.config.pullLastSyncedAt, timezone)}.</span>}
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBox placeholder="Receipt, account, phone or name…" defaultValue={q} />
        <FilterSelect name="status" label="Any status" value={sp.status} options={STATUSES.map((s) => ({ value: s, label: LABEL[s] }))} />
        {unmatched > 0 && <Link href="?status=UNMATCHED"><Badge variant="warning">{unmatched} unmatched</Badge></Link>}
      </div>
      {rows.length === 0 ? <EmptyState title="No transactions pulled yet" /> : (
        <>
          <Table>
            <THead><tr><TH>Received</TH><TH>Receipt</TH><TH>From</TH><TH>Account</TH><TH>Amount</TH><TH>Status</TH><TH /></tr></THead>
            <tbody>
              {rows.map((t) => (
                <TR key={t.id}>
                  <TD className="whitespace-nowrap text-muted">{formatDateTime(t.transactionDate, timezone)}</TD>
                  <TD className="font-mono text-xs">{t.transactionId}</TD>
                  <TD className="text-xs">{t.sender ?? "—"}<div className="font-mono text-muted">{t.msisdn ?? ""}</div></TD>
                  <TD className="font-mono text-xs">{t.billReference ?? "—"}</TD>
                  <TD className="font-mono">{formatMoney(t.amount, currency)}</TD>
                  <TD>
                    <Badge variant={VARIANT[t.matchStatus] ?? "neutral"}>{LABEL[t.matchStatus] ?? t.matchStatus}</Badge>
                    {t.payment && <Link href={`/admin/payments/${t.payment.id}`} className="ml-2 font-mono text-xs text-brand-ink">{t.payment.order.number}</Link>}
                    {t.note && <div className="mt-1 max-w-56 text-xs text-muted">{t.note}</div>}
                  </TD>
                  <TD className="whitespace-nowrap text-right">
                    {canReconcile && t.matchStatus === "UNMATCHED" && (
                      <div className="flex justify-end gap-1">
                        <FormDialog trigger="Link to order" title="Apply to an order" description={`Settles the order with M-Pesa ${t.transactionId}. The amount must equal the order total.`} action={linkMpesaTransactionAction.bind(null, t.id)} submitLabel="Settle order">
                          <Label htmlFor={`order-${t.id}`}>Order number</Label><Input id={`order-${t.id}`} name="order" required className="font-mono uppercase" defaultValue={t.billReference ?? ""} />
                        </FormDialog>
                        <FormDialog trigger="Ignore" title="Ignore transaction" description="For money that is not for an order on this site." action={ignoreMpesaTransactionAction.bind(null, t.id)} submitLabel="Ignore" variant="ghost">
                          <Label htmlFor={`note-${t.id}`}>Reason</Label><Textarea id={`note-${t.id}`} name="note" required />
                        </FormDialog>
                      </div>
                    )}
                  </TD>
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
