import Link from "next/link";
import { Download } from "lucide-react";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { stockReport } from "@/server/shop/reports";
import { PageHeader, Table, THead, TH, TR, TD, EmptyState } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/forms/action-form";
import { FormDialog } from "@/components/admin/admin-ui";
import { SearchBox } from "@/components/admin/list-tools";
import { adjustStockAction } from "@/actions/admin-shop";
import { formatDateTime, humanize } from "@/lib/format";
import { optionsLabel, parseOptions } from "@/lib/shop";
import { cn } from "@/lib/utils";

export const metadata = { title: "Inventory" };

const REASONS = ["New stock received", "Stock count correction", "Damaged", "Lost / missing", "Returned by customer", "Used for events / giveaways", "Other"];

export default async function Inventory({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string; variant?: string }> }) {
  await requirePermission("shop.inventory", "/admin/shop/inventory");
  const sp = await searchParams;
  const filter = sp.filter === "low" || sp.filter === "out" ? sp.filter : "all";
  const q = sp.q?.trim().slice(0, 80) || undefined;
  const { timezone: tz } = await getSettings("general");
  const [rows, movements] = await Promise.all([
    stockReport(filter, q),
    prisma.stockMovement.findMany({ where: sp.variant ? { variantId: sp.variant } : {}, orderBy: { createdAt: "desc" }, take: 60, include: { variant: { include: { product: { select: { name: true } } } }, shopOrder: { select: { id: true, number: true } } } }),
  ]);
  const actors = await prisma.user.findMany({ where: { id: { in: movements.map((m) => m.actorId).filter((v): v is string => Boolean(v)) } }, select: { id: true, name: true } });
  const chip = (on: boolean) => cn("rounded-full border px-4 py-2 text-sm font-medium", on ? "border-brand bg-brand text-brand-foreground" : "border-border text-muted hover:text-foreground");
  const totals = rows.reduce((t, r) => ({ onHand: t.onHand + r.onHand, reserved: t.reserved + r.reserved }), { onHand: 0, reserved: 0 });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Inventory"
        description={`Stock is reserved when a customer places an order and deducted only after M-Pesa confirms payment. ${totals.onHand} units on hand, ${totals.reserved} reserved by unpaid orders.`}
        actions={
           
          <Button asChild variant="secondary" size="sm"><a href={`/admin/export/shop-inventory${filter !== "all" ? `?filter=${filter}` : ""}`}><Download />Stock CSV</a></Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/admin/shop/inventory" className={chip(filter === "all")}>All stock</Link>
        <Link href="/admin/shop/inventory?filter=low" className={chip(filter === "low")}>Low & out</Link>
        <Link href="/admin/shop/inventory?filter=out" className={chip(filter === "out")}>Out of stock</Link>
        <div className="ml-auto w-full sm:w-72"><SearchBox placeholder="Product or SKU…" defaultValue={q} /></div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={filter === "all" ? "No products yet" : "Nothing low on stock"} description={filter === "all" ? "Create products to start tracking stock." : "All items are above their alert level."} action={filter === "all" ? <Button asChild><Link href="/admin/manage/products/new">New product</Link></Button> : undefined} />
      ) : (
        <Table>
          <THead><tr><TH>Product</TH><TH>SKU</TH><TH className="text-right">On hand</TH><TH className="text-right">Reserved</TH><TH className="text-right">Available</TH><TH className="text-right">Alert at</TH><TH /></tr></THead>
          <tbody>
            {rows.map((r) => (
              <TR key={r.variantId} className={!r.active ? "opacity-60" : ""}>
                <TD>
                  <Link href={`/admin/manage/products/${r.productId}`} className="font-medium hover:text-brand-ink">{r.product}</Link>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">{r.variant !== "—" && <span>{r.variant}</span>}{r.status !== "PUBLISHED" && <StatusBadge status={r.status} className="px-2 py-0 text-[10px]" />}{!r.active && <span>hidden variant</span>}</div>
                </TD>
                <TD className="font-mono text-xs">{r.sku}</TD>
                <TD className="text-right tabular-nums">{r.onHand}</TD>
                <TD className="text-right tabular-nums text-muted">{r.reserved}</TD>
                <TD className="text-right">{r.state === "out" ? <Badge variant="danger">0</Badge> : r.state === "low" ? <Badge variant="warning">{r.available}</Badge> : <span className="font-semibold tabular-nums">{r.available}</span>}</TD>
                <TD className="text-right text-muted">{r.threshold}</TD>
                <TD className="whitespace-nowrap text-right">
                  <FormDialog trigger="Adjust" title={`Adjust stock — ${r.product}${r.variant !== "—" ? ` (${r.variant})` : ""}`} description={`On hand ${r.onHand}, reserved ${r.reserved}. Every adjustment is logged with your name.`} action={adjustStockAction.bind(null, r.variantId)} submitLabel="Save adjustment">
                    <Field name="direction" label="Change">
                      <Select name="direction" defaultValue="in">
                        <option value="in">Add stock (+)</option>
                        <option value="out">Remove stock (−)</option>
                        <option value="set">Set exact count</option>
                      </Select>
                    </Field>
                    <Field name="quantity" label="Quantity"><Input name="quantity" type="number" min={0} step={1} required /></Field>
                    <Field name="reason" label="Reason"><Select name="reason" defaultValue={REASONS[0]}>{REASONS.map((x) => <option key={x}>{x}</option>)}</Select></Field>
                    <Field name="note" label="Note (optional)"><Input name="note" placeholder="Supplier invoice, who counted…" /></Field>
                  </FormDialog>
                  <Button asChild variant="ghost" size="sm"><Link href={`/admin/shop/inventory?variant=${r.variantId}${filter !== "all" ? `&filter=${filter}` : ""}#movements`}>History</Link></Button>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}

      <Card id="movements">
        <CardHeader><CardTitle>{sp.variant ? "Stock history for this item" : "Recent stock movements"}</CardTitle>{sp.variant && <Link href="/admin/shop/inventory" className="text-sm text-brand-ink">Show all</Link>}</CardHeader>
        <CardContent className="p-0">
          {movements.length ? (
            <Table className="rounded-none border-0">
              <THead><tr><TH>When</TH><TH>Item</TH><TH>Type</TH><TH className="text-right">On hand Δ</TH><TH className="text-right">Reserved Δ</TH><TH className="text-right">After</TH><TH>Reason</TH></tr></THead>
              <tbody>
                {movements.map((m) => (
                  <TR key={m.id}>
                    <TD className="whitespace-nowrap text-xs text-muted">{formatDateTime(m.createdAt, tz)}</TD>
                    <TD className="text-sm">{m.variant.product.name}<div className="text-xs text-muted">{optionsLabel(parseOptions(m.variant.options)) || m.variant.sku}</div></TD>
                    <TD><Badge variant={m.type === "SALE" ? "success" : m.type === "RESERVE" || m.type === "RELEASE" ? "neutral" : "default"}>{humanize(m.type)}</Badge></TD>
                    <TD className={cn("text-right font-mono", m.quantity > 0 ? "text-success" : m.quantity < 0 ? "text-danger" : "text-muted")}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</TD>
                    <TD className="text-right font-mono text-muted">{m.reservedDelta > 0 ? `+${m.reservedDelta}` : m.reservedDelta}</TD>
                    <TD className="text-right font-mono text-xs">{m.onHandAfter} / {m.reservedAfter}</TD>
                    <TD className="text-sm">{m.reason}{m.shopOrder && <> · <Link href={`/admin/shop/orders/${m.shopOrder.id}`} className="font-mono text-brand-ink">{m.shopOrder.number}</Link></>}<div className="text-xs text-muted">{m.actorId ? (actors.find((a) => a.id === m.actorId)?.name ?? "Staff") : "System"}</div></TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          ) : <p className="p-5 text-sm text-muted">No stock movements yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
