import Link from "next/link";
import { Receipt } from "lucide-react";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { PageHeader, EmptyState, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatMoney } from "@/lib/format";

export default async function PaymentsPage() {
  const user = await requireUser("/dashboard/payments");
  const { timezone } = await getSettings("general");
  const now = new Date();
  const orders = await prisma.order.findMany({ where: { userId: user.id }, include: { items: true, payments: { orderBy: { createdAt: "desc" }, take: 1 }, invoice: true }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <div>
      <PageHeader eyebrow="Billing" title="Payments & receipts" />
      {orders.length === 0 ? (
        <EmptyState icon={<Receipt />} title="No payments yet" description="Your M-Pesa payments and invoices will appear here." />
      ) : (
        <Table>
          <THead><tr><TH>Order</TH><TH>Items</TH><TH>Total</TH><TH>Status</TH><TH>M-Pesa</TH><TH /></tr></THead>
          <tbody>
            {orders.map((o) => {
              const open = o.status === "PENDING" && (!o.expiresAt || o.expiresAt > now);
              const status = o.status === "PENDING" && !open ? "EXPIRED" : o.status;
              return (
                <TR key={o.id}>
                  <TD><div className="font-mono text-xs">{o.number}</div><div className="text-xs text-muted">{formatDateTime(o.createdAt, timezone)}</div></TD>
                  <TD className="max-w-xs truncate">{o.items.map((i) => i.description).join(", ")}</TD>
                  <TD className="font-mono">{formatMoney(o.total, o.currency)}</TD>
                  <TD><StatusBadge status={status} /></TD>
                  <TD className="font-mono text-xs">{o.payments[0]?.receiptNumber ?? (o.payments[0] ? o.payments[0].status.toLowerCase() : "—")}</TD>
                  <TD className="text-right">
                    {open ? <Button asChild size="sm"><Link href={`/pay/${o.id}`}>Pay</Link></Button> : o.invoice ? <Button asChild size="sm" variant="secondary"><Link href={`/invoices/${o.invoice.number}`}>Invoice</Link></Button> : null}
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
