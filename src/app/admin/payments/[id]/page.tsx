import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { can } from "@/server/rbac";
import { getSettings } from "@/server/settings";
import { PageHeader, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Input, Label, Textarea } from "@/components/ui/input";
import { ActionButton, FormDialog } from "@/components/admin/admin-ui";
import { markRefundedAction, reconcilePaymentAction, settlePaymentManuallyAction } from "@/actions/admin";
import { formatDateTime, formatMoney } from "@/lib/format";

export const metadata = { title: "Payment" };

export default async function PaymentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("payments.view", `/admin/payments/${id}`);
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: { user: true, provider: true, order: { include: { items: true, invoice: true } }, transactions: { orderBy: { createdAt: "asc" } }, callbacks: { orderBy: { receivedAt: "asc" } } },
  });
  if (!payment) notFound();
  const { timezone } = await getSettings("general");
  const canReconcile = await can(actor.role, "payments.reconcile");
  const open = ["PENDING", "PROCESSING", "EXPIRED"].includes(payment.status);
  const rows: [string, React.ReactNode][] = [
    ["Member", <Link key="m" href={`/admin/users/${payment.userId}`} className="text-brand">{payment.user.name}</Link>],
    ["Amount", <span key="a" className="font-mono">{formatMoney(payment.amount, payment.currency)}</span>],
    ["Phone", <span key="p" className="font-mono">{payment.phoneNumber}</span>],
    ["Provider", payment.provider.name],
    ["Account reference", <span key="r" className="font-mono">{payment.accountReference}</span>],
    ["CheckoutRequestID", <span key="c" className="break-all font-mono text-xs">{payment.checkoutRequestId ?? "—"}</span>],
    ["MerchantRequestID", <span key="mr" className="break-all font-mono text-xs">{payment.merchantRequestId ?? "—"}</span>],
    ["M-Pesa receipt", <span key="rc" className="font-mono">{payment.receiptNumber ?? "—"}</span>],
    ["Result code", payment.resultCode ?? "—"],
    ["Failure reason", payment.failureReason ?? "—"],
    ["Created", formatDateTime(payment.createdAt, timezone)],
    ["Completed", payment.completedAt ? formatDateTime(payment.completedAt, timezone) : "—"],
    ["Last status query", payment.lastQueriedAt ? formatDateTime(payment.lastQueriedAt, timezone) : "—"],
  ];
  return (
    <div className="grid gap-6">
      <Link href="/admin/payments" className="text-sm text-muted hover:text-foreground">← Payments</Link>
      <PageHeader
        title={`Payment for order ${payment.order.number}`}
        actions={
          <>
            <StatusBadge status={payment.status} />
            {canReconcile && open && payment.checkoutRequestId && <ActionButton action={reconcilePaymentAction.bind(null, payment.id)}>Query M-Pesa status</ActionButton>}
            {canReconcile && actor.role === "SUPER_ADMIN" && payment.status !== "SUCCESS" && payment.status !== "REFUNDED" && (
              <FormDialog trigger="Settle manually" title="Settle manually" description="Only after confirming the funds on the M-Pesa portal. This fulfils the order and is permanently audited." action={settlePaymentManuallyAction.bind(null, payment.id)} submitLabel="Confirm settlement" variant="ghost">
                <Label htmlFor="receipt">M-Pesa receipt code</Label><Input id="receipt" name="receipt" required className="font-mono uppercase" />
                <Label htmlFor="note">How was it verified?</Label><Textarea id="note" name="note" required />
              </FormDialog>
            )}
            {canReconcile && payment.status === "SUCCESS" && (
              <FormDialog trigger="Mark refunded" title="Record a refund" description="Records that the money was returned (complete the reversal in M-Pesa separately)." action={markRefundedAction.bind(null, payment.id)} submitLabel="Mark refunded" variant="ghost" submitVariant="danger">
                <Label htmlFor="rnote">Refund reference / note</Label><Textarea id="rnote" name="note" required />
              </FormDialog>
            )}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid gap-2.5 text-sm">
              {rows.map(([k, v]) => <div key={k} className="grid grid-cols-[160px_1fr] gap-3"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>)}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Order</CardTitle><StatusBadge status={payment.order.status} /></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {payment.order.items.map((i) => (
              <div key={i.id} className="flex justify-between gap-3"><span>{i.description}{i.fulfilledAt ? <Badge variant="success" className="ml-2">fulfilled</Badge> : null}</span><span className="font-mono">{formatMoney(i.total, payment.order.currency)}</span></div>
            ))}
            <div className="mt-2 flex justify-between border-t border-border pt-2 font-semibold"><span>Total</span><span className="font-mono">{formatMoney(payment.order.total, payment.order.currency)}</span></div>
            {payment.order.invoice && <Link href={`/invoices/${payment.order.invoice.number}`} className="text-brand">Invoice {payment.order.invoice.number}</Link>}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Transaction log</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table className="rounded-none border-0">
            <THead><tr><TH>When</TH><TH>Kind</TH><TH>Status</TH><TH>Reference</TH><TH>Message</TH></tr></THead>
            <tbody>
              {payment.transactions.map((t) => (
                <TR key={t.id}><TD className="whitespace-nowrap text-muted">{formatDateTime(t.createdAt, timezone)}</TD><TD><Badge variant="neutral">{t.kind}</Badge></TD><TD><StatusBadge status={t.status} /></TD><TD className="font-mono text-xs">{t.reference ?? "—"}</TD><TD className="text-muted">{t.message ?? "—"}</TD></TR>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Provider callbacks ({payment.callbacks.length})</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          {payment.callbacks.length ? payment.callbacks.map((c) => (
            <details key={c.id} className="rounded-xl bg-surface-2 p-3 text-sm">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">{formatDateTime(c.receivedAt, timezone)}<Badge variant={c.verified ? "success" : "warning"}>{c.verified ? "verified" : "unverified"}</Badge><span className="text-muted">{c.outcome} · {c.sourceIp}</span></summary>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-black/40 p-3 font-mono text-xs">{JSON.stringify(c.payload, null, 2)}</pre>
            </details>
          )) : <p className="text-sm text-muted">No callbacks received for this payment.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
