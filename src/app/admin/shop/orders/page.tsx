import Link from "next/link";
import { Download } from "lucide-react";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { shopOrderWhere } from "@/server/shop/reports";
import { PageHeader, Table, THead, TH, TR, TD, EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { DateFilter, FilterSelect, Pagination, SearchBox } from "@/components/admin/list-tools";
import { formatDateTime, formatMoney } from "@/lib/format";
import { SHOP_STATUS_LABELS, SHOP_STATUSES } from "@/lib/shop";

export const metadata = { title: "Shop orders" };
const PAGE_SIZE = 30;

export default async function ShopOrders({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("shop.orders", "/admin/shop/orders");
  const sp = await searchParams;
  const { timezone: tz } = await getSettings("general");
  const page = Math.max(1, Number(sp.page) || 1);
  const where = shopOrderWhere(sp, tz);
  const [orders, total, sums] = await Promise.all([
    prisma.shopOrder.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { items: { select: { quantity: true, productName: true } } } }),
    prisma.shopOrder.count({ where }),
    prisma.shopOrder.aggregate({ where: { ...where, paidAt: { not: null }, status: { notIn: ["REFUNDED", "CANCELLED"] } }, _sum: { total: true } }),
  ]);
  const exportQuery = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]).toString();

  return (
    <div>
      <PageHeader
        title="Shop orders"
        description={`${total} order${total === 1 ? "" : "s"} · paid value ${formatMoney(sums._sum.total?.toNumber() ?? 0, "KES")}`}
        actions={
           
          <Button asChild variant="secondary" size="sm"><a href={`/admin/export/shop-orders${exportQuery ? `?${exportQuery}` : ""}`}><Download />Export CSV</a></Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBox placeholder="Order no., name, phone, email, product…" defaultValue={sp.q} />
        <FilterSelect name="status" value={sp.status} label="All statuses" options={SHOP_STATUSES.map((s) => ({ value: s, label: SHOP_STATUS_LABELS[s] }))} />
        <FilterSelect name="method" value={sp.method} label="Delivery & pick-up" options={[{ value: "DELIVERY", label: "Delivery" }, { value: "COLLECTION", label: "Pick-up" }]} />
        <DateFilter name="from" value={sp.from} label="From" />
        <DateFilter name="to" value={sp.to} label="To" />
      </div>
      {orders.length === 0 ? (
        <EmptyState title="No orders found" description="Try different filters." />
      ) : (
        <>
          <Table>
            <THead><tr><TH>Order</TH><TH>Customer</TH><TH>Items</TH><TH>Fulfilment</TH><TH>Placed</TH><TH className="text-right">Total</TH><TH>Status</TH></tr></THead>
            <tbody>
              {orders.map((o) => (
                <TR key={o.id}>
                  <TD><Link href={`/admin/shop/orders/${o.id}`} className="font-mono font-semibold hover:text-brand-ink">{o.number}</Link></TD>
                  <TD><div className="font-medium">{o.customerName}</div><div className="text-xs text-muted">{o.customerPhone}</div></TD>
                  <TD className="max-w-56"><div className="truncate text-sm">{o.items.map((i) => `${i.quantity}× ${i.productName}`).join(", ")}</div></TD>
                  <TD className="text-sm">{o.fulfillmentMethod === "COLLECTION" ? "Pick-up" : `Delivery${o.county ? ` · ${o.county}` : ""}`}</TD>
                  <TD className="whitespace-nowrap text-sm text-muted">{formatDateTime(o.createdAt, tz)}</TD>
                  <TD className="text-right font-mono">{formatMoney(o.total, o.currency)}</TD>
                  <TD><StatusBadge status={o.status} /></TD>
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
