import Link from "next/link";
import { Download } from "lucide-react";
import { requirePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { cancelledAndRefunded, fulfilmentPerformance, rangeFrom, reconciliation, salesByCategory, salesByDay, salesByProduct, salesSummary, stockReport } from "@/server/shop/reports";
import { PageHeader, Stat, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { DateFilter } from "@/components/admin/list-tools";
import { RevenueChart } from "@/components/admin/revenue-chart";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";

export const metadata = { title: "Shop reports" };

const hours = (h: number | null) => (h === null ? "—" : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);

export default async function ShopReports({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requirePermission("reports.view", "/admin/shop/reports");
  const sp = await searchParams;
  const range = await rangeFrom(sp);
  const { timezone: tz, currency } = await getSettings("general");
  const [summary, days, byProduct, byCategory, stock, performance, recon, closed] = await Promise.all([
    salesSummary(range),
    salesByDay(range),
    salesByProduct(range, 100),
    salesByCategory(range),
    stockReport("all"),
    fulfilmentPerformance(range),
    reconciliation(range),
    cancelledAndRefunded(range),
  ]);
  const q = `from=${range.fromKey}&to=${range.toKey}`;
  const money = (n: number) => formatMoney(n, currency);
  const stockCounts = { ok: stock.filter((s) => s.active && s.state === "ok").length, low: stock.filter((s) => s.active && s.state === "low").length, out: stock.filter((s) => s.active && s.state === "out").length };
  const exportBtn = (kind: string, label: string, query = q) => (
     
    <Button asChild variant="secondary" size="sm"><a href={`/admin/export/${kind}?${query}`}><Download />{label}</a></Button>
  );

  return (
    <div className="grid gap-6">
      <PageHeader title="Shop reports" description={`${formatDate(range.from, tz)} – ${formatDate(new Date(range.to.getTime() - 1), tz)} · sales count paid orders that weren't refunded.`} actions={<>{exportBtn("shop-orders", "Orders CSV")}{exportBtn("shop-sales", "Sales by product CSV")}{exportBtn("shop-reconciliation", "Reconciliation CSV")}</>} />
      <div className="flex flex-wrap items-center gap-3">
        <DateFilter name="from" value={range.fromKey} label="From" />
        <DateFilter name="to" value={range.toKey} label="To" />
        <Link href="/admin/shop/reports" className="text-sm text-brand-ink">Last 30 days</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sales" value={money(summary.revenue)} hint={`${summary.orders} orders · avg ${money(Math.round(summary.average))}`} />
        <Stat label="Delivery fees" value={money(summary.delivery)} />
        <Stat label="Discounts given" value={money(summary.discounts)} />
        <Stat label="Refunded" value={money(summary.refunded)} hint={`${summary.refunds} order${summary.refunds === 1 ? "" : "s"}`} />
      </div>

      <Card><CardContent className="pt-6"><RevenueChart title="Sales by day" points={days.map((d) => ({ date: d.date, label: formatDate(`${d.date}T12:00:00Z`, tz, { day: "numeric", month: "short" }), amount: d.total, display: `${money(d.total)} · ${d.orders} order${d.orders === 1 ? "" : "s"}` }))} /></CardContent></Card>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Revenue by product (best sellers first)</CardTitle></CardHeader>
          <CardContent className="p-0">
            {byProduct.length ? (
              <Table className="rounded-none border-0">
                <THead><tr><TH>Product</TH><TH>Category</TH><TH className="text-right">Units</TH><TH className="text-right">Orders</TH><TH className="text-right">Revenue</TH></tr></THead>
                <tbody>{byProduct.map((p) => <TR key={p.productId}><TD><Link href={`/admin/manage/products/${p.productId}`} className="hover:text-brand-ink">{p.name}</Link></TD><TD className="text-muted">{p.category}</TD><TD className="text-right">{Number(p.quantity)}</TD><TD className="text-right">{Number(p.orders)}</TD><TD className="text-right font-mono">{money(Number(p.revenue))}</TD></TR>)}</tbody>
              </Table>
            ) : <p className="p-5 text-sm text-muted">No sales in this period.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Revenue by category</CardTitle></CardHeader>
          <CardContent className="p-0">
            {byCategory.length ? (
              <Table className="min-w-0 rounded-none border-0">
                <THead><tr><TH>Category</TH><TH className="text-right">Units</TH><TH className="text-right">Revenue</TH></tr></THead>
                <tbody>{byCategory.map((c) => <TR key={c.category}><TD>{c.category}</TD><TD className="text-right">{Number(c.quantity)}</TD><TD className="text-right font-mono">{money(Number(c.revenue))}</TD></TR>)}</tbody>
              </Table>
            ) : <p className="p-5 text-sm text-muted">No sales in this period.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Stock availability (now)</CardTitle>{exportBtn("shop-inventory", "Stock CSV", "")}</CardHeader>
          <CardContent className="grid grid-cols-3 gap-3">
            <Link href="/admin/shop/inventory" className="rounded-xl border border-border p-4"><div className="text-xs text-muted">In stock</div><div className="font-display text-2xl font-extrabold">{stockCounts.ok}</div></Link>
            <Link href="/admin/shop/inventory?filter=low" className="rounded-xl border border-warning/40 p-4"><div className="text-xs text-muted">Low stock</div><div className="font-display text-2xl font-extrabold text-warning">{stockCounts.low}</div></Link>
            <Link href="/admin/shop/inventory?filter=out" className="rounded-xl border border-danger/40 p-4"><div className="text-xs text-muted">Out of stock</div><div className="font-display text-2xl font-extrabold text-danger">{stockCounts.out}</div></Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Fulfilment performance</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table className="min-w-0 rounded-none border-0">
              <THead><tr><TH>Method</TH><TH className="text-right">Paid</TH><TH className="text-right">Dispatched / ready</TH><TH className="text-right">Avg to dispatch</TH><TH className="text-right">Avg to complete</TH></tr></THead>
              <tbody>
                {performance.rows.length ? performance.rows.map((r) => <TR key={r.method}><TD>{r.method === "COLLECTION" ? "Pick-up" : "Delivery"}</TD><TD className="text-right">{r.orders}</TD><TD className="text-right">{r.dispatched}</TD><TD className="text-right">{hours(r.avgDispatchHours)}</TD><TD className="text-right">{hours(r.avgDeliverHours)}</TD></TR>) : <TR><TD colSpan={5} className="text-muted">No paid orders in this period.</TD></TR>}
              </tbody>
            </Table>
            {performance.waiting.length > 0 && (
              <div className="border-t border-border p-4 text-sm">
                <div className="mb-2 font-semibold text-warning">Waiting more than 48 hours since payment</div>
                <ul className="grid gap-1">{performance.waiting.map((w) => <li key={w.id}><Link href={`/admin/shop/orders/${w.id}`} className="font-mono text-brand-ink">{w.number}</Link> · {w.customerName} · paid {formatDateTime(w.paidAt!, tz)}</li>)}</ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Payment reconciliation</CardTitle><span className="text-xs text-muted">{recon.rows.length} orders · {recon.exceptions.length} need attention</span></CardHeader>
        <CardContent className="p-0">
          {recon.rows.length ? (
            <Table className="rounded-none border-0">
              <THead><tr><TH>Order</TH><TH>Status</TH><TH className="text-right">Order total</TH><TH className="text-right">M-Pesa amount</TH><TH>Receipt</TH><TH>Attempts</TH><TH>Check</TH></tr></THead>
              <tbody>
                {[...recon.exceptions, ...recon.rows.filter((r) => !r.issues.length)].slice(0, 100).map((r) => (
                  <TR key={r.id}>
                    <TD><Link href={`/admin/shop/orders/${r.id}`} className="font-mono font-semibold hover:text-brand-ink">{r.number}</Link><div className="text-xs text-muted">{r.customer}</div></TD>
                    <TD><StatusBadge status={r.status} /></TD>
                    <TD className="text-right font-mono">{money(r.total)}</TD>
                    <TD className="text-right font-mono">{r.amount === null ? "—" : money(r.amount)}</TD>
                    <TD className="font-mono text-xs">{r.receipt ?? "—"}</TD>
                    <TD>{r.attempts}</TD>
                    <TD>{r.issues.length ? r.issues.map((i) => <Badge key={i} variant="warning" className="mb-1 mr-1 normal-case">{i}</Badge>) : <Badge variant="success">OK</Badge>}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          ) : <p className="p-5 text-sm text-muted">No orders in this period.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Cancelled & refunded orders</CardTitle></CardHeader>
        <CardContent className="p-0">
          {closed.length ? (
            <Table className="rounded-none border-0">
              <THead><tr><TH>Order</TH><TH>Customer</TH><TH>Status</TH><TH className="text-right">Total</TH><TH>Paid?</TH><TH>Reason / reference</TH><TH>When</TH></tr></THead>
              <tbody>{closed.map((o) => <TR key={o.id}><TD><Link href={`/admin/shop/orders/${o.id}`} className="font-mono hover:text-brand-ink">{o.number}</Link></TD><TD>{o.customerName}</TD><TD><StatusBadge status={o.status} /></TD><TD className="text-right font-mono">{money(o.total.toNumber())}</TD><TD>{o.paidAt ? "Yes" : "No"}</TD><TD className="max-w-64 text-sm text-muted">{o.refundReference ? `Ref ${o.refundReference}` : o.cancelReason}</TD><TD className="whitespace-nowrap text-xs text-muted">{formatDateTime((o.refundedAt ?? o.cancelledAt)!, tz)}</TD></TR>)}</tbody>
            </Table>
          ) : <p className="p-5 text-sm text-muted">None in this period.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
