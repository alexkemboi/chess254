import Link from "next/link";
import { AlertTriangle, Banknote, CheckCircle2, Clock, Package, PackageCheck, Plus, ShoppingBag, Truck, XCircle } from "lucide-react";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { rangeFrom, salesByDay, salesByProduct, salesSummary, statusCounts, stockReport } from "@/server/shop/reports";
import { PageHeader, Stat, Table, THead, TH, TR, TD, EmptyState } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { RevenueChart } from "@/components/admin/revenue-chart";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";

export const metadata = { title: "Shop" };

export default async function ShopDashboard() {
  await requirePermission("shop.orders", "/admin/shop");
  const { timezone: tz, currency } = await getSettings("general");
  const range = await rangeFrom({});
  const [{ counts, total }, summary, days, best, low, recent, products] = await Promise.all([
    statusCounts(),
    salesSummary(range),
    salesByDay(range),
    salesByProduct(null, 5),
    stockReport("low"),
    prisma.shopOrder.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { _count: { select: { items: true } } } }),
    prisma.product.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const c = (s: keyof typeof counts) => counts[s] ?? 0;
  const published = products.find((p) => p.status === "PUBLISHED")?._count._all ?? 0;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Shop"
        description={`Merchandise orders, sales and stock. ${published} published product${published === 1 ? "" : "s"}.`}
        actions={
          <>
            <Button asChild size="sm"><Link href="/admin/manage/products/new"><Plus />New product</Link></Button>
            <Button asChild variant="secondary" size="sm"><Link href="/admin/shop/orders">All orders</Link></Button>
            <Button asChild variant="secondary" size="sm"><Link href="/admin/shop/reports">Reports</Link></Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sales (30 days)" value={formatMoney(summary.revenue, currency)} hint={`${summary.orders} paid orders`} icon={<Banknote />} />
        <Stat label="Total orders" value={formatNumber(total)} icon={<ShoppingBag />} />
        <Stat label="Awaiting payment" value={c("PENDING_PAYMENT")} icon={<Clock />} />
        <Stat label="Paid — to fulfil" value={c("PAID")} hint={<Link href="/admin/shop/orders?status=PAID" className="text-brand-ink hover:underline">Fulfil now</Link>} icon={<Package />} />
        <Stat label="Processing" value={c("PROCESSING")} icon={<PackageCheck />} />
        <Stat label="Shipped / ready" value={c("SHIPPED") + c("READY_FOR_COLLECTION")} icon={<Truck />} />
        <Stat label="Completed" value={c("DELIVERED")} icon={<CheckCircle2 />} />
        <Stat label="Cancelled / refunded" value={c("CANCELLED") + c("REFUNDED")} hint={summary.refunded ? `${formatMoney(summary.refunded, currency)} refunded (30 days)` : undefined} icon={<XCircle />} />
      </div>

      <Card>
        <CardContent className="pt-6">
          <RevenueChart title="Daily shop sales (last 30 days)" points={days.map((d) => ({ date: d.date, label: formatDate(`${d.date}T12:00:00Z`, tz, { day: "numeric", month: "short" }), amount: d.total, display: formatMoney(d.total, currency) }))} />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Best-selling products</CardTitle></CardHeader>
          <CardContent className="p-0">
            {best.length ? (
              <Table className="rounded-none border-0">
                <THead><tr><TH>Product</TH><TH className="text-right">Sold</TH><TH className="text-right">Revenue</TH></tr></THead>
                <tbody>{best.map((b) => <TR key={b.productId}><TD><Link href={`/admin/manage/products/${b.productId}`} className="hover:text-brand-ink">{b.name}</Link></TD><TD className="text-right">{Number(b.quantity)}</TD><TD className="text-right font-mono">{formatMoney(Number(b.revenue), currency)}</TD></TR>)}</tbody>
              </Table>
            ) : <p className="p-5 text-sm text-muted">No sales yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning" />Low & out of stock</CardTitle></CardHeader>
          <CardContent className="p-0">
            {low.length ? (
              <Table className="rounded-none border-0">
                <THead><tr><TH>Item</TH><TH className="text-right">Available</TH><TH className="text-right">Alert at</TH></tr></THead>
                <tbody>{low.slice(0, 8).map((r) => <TR key={r.variantId}><TD><div className="font-medium">{r.product}</div><div className="text-xs text-muted">{r.variant} · {r.sku}</div></TD><TD className={`text-right font-semibold ${r.state === "out" ? "text-danger" : "text-warning"}`}>{r.available}</TD><TD className="text-right text-muted">{r.threshold}</TD></TR>)}</tbody>
              </Table>
            ) : <p className="p-5 text-sm text-muted">Everything is well stocked.</p>}
            <div className="border-t border-border p-3 text-right"><Link href="/admin/shop/inventory" className="text-sm font-semibold text-brand-ink hover:underline">Manage inventory →</Link></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Recent orders</CardTitle></CardHeader>
        <CardContent className="p-0">
          {recent.length ? (
            <Table className="rounded-none border-0">
              <THead><tr><TH>Order</TH><TH>Customer</TH><TH>Placed</TH><TH className="text-right">Total</TH><TH>Status</TH></tr></THead>
              <tbody>
                {recent.map((o) => (
                  <TR key={o.id}>
                    <TD><Link href={`/admin/shop/orders/${o.id}`} className="font-mono font-semibold hover:text-brand-ink">{o.number}</Link></TD>
                    <TD>{o.customerName}<div className="text-xs text-muted">{o._count.items} item{o._count.items === 1 ? "" : "s"} · {o.fulfillmentMethod === "COLLECTION" ? "Pick-up" : "Delivery"}</div></TD>
                    <TD className="text-muted">{formatDateTime(o.createdAt, tz)}</TD>
                    <TD className="text-right font-mono">{formatMoney(o.total, o.currency)}</TD>
                    <TD><StatusBadge status={o.status} /></TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          ) : <div className="p-5"><EmptyState title="No orders yet" description="Orders appear here as soon as customers check out." /></div>}
        </CardContent>
      </Card>
    </div>
  );
}
