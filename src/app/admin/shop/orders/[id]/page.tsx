import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, MapPin, Store, Truck } from "lucide-react";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { can } from "@/server/rbac";
import { getSettings } from "@/server/settings";
import { shopOrderPath } from "@/server/shop/links";
import { PageHeader, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/forms/action-form";
import { FormDialog } from "@/components/admin/admin-ui";
import { Img as Image } from "@/components/ui/img";
import { addShopOrderNoteAction, transitionShopOrderAction, updateFulfilmentAction } from "@/actions/admin-shop";
import { formatDateTime, formatMoney } from "@/lib/format";
import { allowedTransitions, SHOP_STATUS_LABELS, stepLabel, type ShopStatus } from "@/lib/shop";

export const metadata = { title: "Shop order" };

const ACTION_LABEL: Partial<Record<ShopStatus, string>> = {
  PROCESSING: "Start processing",
  READY_FOR_COLLECTION: "Ready for collection",
  SHIPPED: "Mark dispatched",
  DELIVERED: "Mark delivered",
  CANCELLED: "Cancel order",
  REFUNDED: "Record refund",
};

function Check({ name, label, defaultChecked = false }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-[var(--brand)]" />{label}
    </label>
  );
}

export default async function ShopOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("shop.orders", `/admin/shop/orders/${id}`);
  const so = await prisma.shopOrder.findUnique({
    where: { id },
    include: {
      items: { include: { variant: { select: { stockOnHand: true, stockReserved: true } } } },
      order: { include: { payments: { orderBy: { createdAt: "desc" } }, invoice: true } },
      events: { orderBy: { createdAt: "asc" } },
      user: { select: { id: true, email: true, passwordHash: true } },
    },
  });
  if (!so) notFound();
  const { timezone: tz } = await getSettings("general");
  const [canRefund, canPayments] = await Promise.all([can(user.role, "shop.refunds"), can(user.role, "payments.view")]);
  const actors = await prisma.user.findMany({ where: { id: { in: so.events.map((e) => e.actorId).filter((v): v is string => Boolean(v)) } }, select: { id: true, name: true } });
  const actorName = (aid: string | null) => (aid ? (actors.find((a) => a.id === aid)?.name ?? "Staff") : "System");
  const transitions = allowedTransitions(so).filter((t) => (t === "REFUNDED" || (t === "CANCELLED" && so.paidAt) ? canRefund : true));
  const act = transitionShopOrderAction.bind(null, so.id);

  return (
    <div className="max-w-6xl">
      <Link href="/admin/shop/orders" className="text-sm text-muted hover:text-foreground">← Shop orders</Link>
      <div className="mt-4">
        <PageHeader
          title={`Order ${so.number}`}
          description={`Placed ${formatDateTime(so.createdAt, tz)} · ${so.customerName}`}
          actions={
            <>
              <Button asChild variant="secondary" size="sm"><Link href={shopOrderPath(so.number)} target="_blank"><ExternalLink />Customer view</Link></Button>
              {so.order.invoice && <Button asChild variant="secondary" size="sm"><Link href={`/invoices/${so.order.invoice.number}`} target="_blank">Invoice</Link></Button>}
            </>
          }
        />
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface p-4">
        <span className="mr-1 text-sm text-muted">Status</span>
        <StatusBadge status={so.status} />
        <span className="mx-2 hidden h-6 w-px bg-border sm:block" />
        {transitions.length === 0 && <span className="text-sm text-muted">{so.status === "PENDING_PAYMENT" ? "Waiting for M-Pesa confirmation." : "No further steps."}</span>}
        {transitions.map((to) => (
          <FormDialog
            key={to}
            trigger={ACTION_LABEL[to] ?? SHOP_STATUS_LABELS[to]}
            title={`${ACTION_LABEL[to] ?? SHOP_STATUS_LABELS[to]} — ${so.number}`}
            description={to === "CANCELLED" && so.paidAt ? "This order is paid. Cancelling alerts admins that a refund is due; record the refund once it is sent." : to === "REFUNDED" ? "Record a refund you have already sent (e.g. M-Pesa reversal). The payment is marked refunded." : undefined}
            action={act}
            submitLabel={ACTION_LABEL[to] ?? "Save"}
            variant={to === "CANCELLED" || to === "REFUNDED" ? "danger" : "default"}
            submitVariant={to === "CANCELLED" || to === "REFUNDED" ? "danger" : "default"}
          >
            <input type="hidden" name="to" value={to} />
            {to === "SHIPPED" && (
              <>
                <Field name="courier" label="Courier / rider"><Input name="courier" defaultValue={so.courier ?? ""} placeholder="e.g. G4S, Fargo, own rider" /></Field>
                <Field name="trackingNumber" label="Tracking / waybill number"><Input name="trackingNumber" defaultValue={so.trackingNumber ?? ""} /></Field>
              </>
            )}
            {to === "DELIVERED" && so.fulfillmentMethod === "COLLECTION" && <Field name="collectedBy" label="Collected by"><Input name="collectedBy" placeholder="Name of the person who collected" /></Field>}
            {to === "REFUNDED" && <Field name="refundReference" label="Refund reference *"><Input name="refundReference" required placeholder="M-Pesa transaction code" /></Field>}
            <Field name="note" label={to === "CANCELLED" ? (so.paidAt ? "Reason *" : "Reason") : to === "READY_FOR_COLLECTION" ? "Pick-up instructions (sent to the customer)" : "Note"}>
              <Textarea name="note" className="min-h-20" required={to === "CANCELLED" && Boolean(so.paidAt)} />
            </Field>
            {(to === "CANCELLED" || to === "REFUNDED") && so.stockCommittedAt && !so.events.some((e) => e.note?.includes("returned to stock")) && <Check name="restock" label="Return the items to stock" defaultChecked />}
            <Check name="notify" label="Email the customer about this update" defaultChecked />
          </FormDialog>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="grid min-w-0 gap-6">
          <Card>
            <CardHeader><CardTitle>Items</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table className="min-w-[520px] rounded-none border-0">
                <THead><tr><TH>Product</TH><TH className="text-right">Qty</TH><TH className="text-right">Unit</TH><TH className="text-right">Total</TH></tr></THead>
                <tbody>
                  {so.items.map((i) => (
                    <TR key={i.id}>
                      <TD>
                        <div className="flex items-center gap-3">
                          <span className="relative size-11 shrink-0 overflow-hidden rounded-lg border border-border bg-white">{i.imageUrl && <Image src={i.imageUrl} alt="" fill sizes="44px" className="object-cover" />}</span>
                          <div>
                            <Link href={`/admin/manage/products/${i.productId}`} className="font-medium hover:text-brand-ink">{i.productName}</Link>
                            <div className="text-xs text-muted">{[i.variantName, i.sku].filter(Boolean).join(" · ")} · {i.variant.stockOnHand - i.variant.stockReserved} available now</div>
                          </div>
                        </div>
                      </TD>
                      <TD className="text-right">{i.quantity}</TD>
                      <TD className="text-right font-mono">{formatMoney(i.unitPrice, so.currency)}</TD>
                      <TD className="text-right font-mono">{formatMoney(i.total, so.currency)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
              <dl className="grid gap-1.5 border-t border-border p-5 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="font-mono">{formatMoney(so.subtotal, so.currency)}</dd></div>
                {so.discountTotal.greaterThan(0) && <div className="flex justify-between"><dt className="text-muted">Discount {so.discountCode}</dt><dd className="font-mono">−{formatMoney(so.discountTotal, so.currency)}</dd></div>}
                <div className="flex justify-between"><dt className="text-muted">{so.deliveryOptionName}</dt><dd className="font-mono">{formatMoney(so.deliveryFee, so.currency)}</dd></div>
                {so.tax.greaterThan(0) && <div className="flex justify-between"><dt className="text-muted">Tax included</dt><dd className="font-mono">{formatMoney(so.tax, so.currency)}</dd></div>}
                <div className="flex justify-between text-base font-bold"><dt>Total</dt><dd className="font-mono">{formatMoney(so.total, so.currency)}</dd></div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>M-Pesa payments</CardTitle><span className="text-xs text-muted">Payment order {so.order.number} · {so.order.status.toLowerCase()}</span></CardHeader>
            <CardContent className="p-0">
              {so.order.payments.length ? (
                <Table className="min-w-[520px] rounded-none border-0">
                  <THead><tr><TH>Started</TH><TH>Phone</TH><TH>Receipt</TH><TH className="text-right">Amount</TH><TH>Status</TH></tr></THead>
                  <tbody>
                    {so.order.payments.map((p) => (
                      <TR key={p.id}>
                        <TD className="text-sm">{canPayments ? <Link href={`/admin/payments/${p.id}`} className="hover:text-brand-ink">{formatDateTime(p.createdAt, tz)}</Link> : formatDateTime(p.createdAt, tz)}</TD>
                        <TD className="font-mono text-xs">{p.phoneNumber}</TD>
                        <TD className="font-mono text-xs">{p.receiptNumber ?? "—"}</TD>
                        <TD className="text-right font-mono">{formatMoney(p.amount, p.currency)}</TD>
                        <TD><StatusBadge status={p.status} />{p.failureReason && <div className="mt-1 max-w-48 text-xs text-muted">{p.failureReason}</div>}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              ) : <p className="p-5 text-sm text-muted">No payment attempts yet.</p>}
            </CardContent>
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader><CardTitle>Customer & fulfilment</CardTitle></CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <div>
                <div className="font-semibold">{so.customerName}</div>
                <div className="break-all text-muted">{so.customerEmail}</div>
                <div className="text-muted">{so.customerPhone}</div>
                <div className="mt-1 text-xs text-muted">{so.user.passwordHash ? "Has a member account" : "Guest checkout"}</div>
              </div>
              <div className="flex gap-2 rounded-xl bg-surface-2 p-3">
                {so.fulfillmentMethod === "COLLECTION" ? <Store className="mt-0.5 size-4 shrink-0 text-brand-ink" /> : <Truck className="mt-0.5 size-4 shrink-0 text-brand-ink" />}
                <div>
                  <div className="font-semibold">{so.deliveryOptionName}</div>
                  {so.fulfillmentMethod === "DELIVERY" && <div className="flex gap-1 text-muted"><MapPin className="mt-0.5 size-3.5 shrink-0" />{[so.address, so.town, so.county].filter(Boolean).join(", ")}</div>}
                  {so.deliveryInstructions && <div className="mt-1 text-muted">“{so.deliveryInstructions}”</div>}
                </div>
              </div>
              <dl className="grid gap-1">
                {so.courier && <div className="flex justify-between gap-3"><dt className="text-muted">Courier</dt><dd>{so.courier}</dd></div>}
                {so.trackingNumber && <div className="flex justify-between gap-3"><dt className="text-muted">Tracking</dt><dd className="font-mono">{so.trackingNumber}</dd></div>}
                {so.collectedBy && <div className="flex justify-between gap-3"><dt className="text-muted">Collected by</dt><dd>{so.collectedBy}</dd></div>}
                {so.refundReference && <div className="flex justify-between gap-3"><dt className="text-muted">Refund ref</dt><dd className="font-mono">{so.refundReference}</dd></div>}
                {so.cancelReason && <div className="flex justify-between gap-3"><dt className="text-muted">Cancel reason</dt><dd className="text-right">{so.cancelReason}</dd></div>}
              </dl>
              {so.fulfillmentNotes && <p className="whitespace-pre-line rounded-xl border border-border p-3 text-muted">{so.fulfillmentNotes}</p>}
              {so.status !== "PENDING_PAYMENT" && (
                <FormDialog trigger="Edit fulfilment details" title="Fulfilment details" action={updateFulfilmentAction.bind(null, so.id)} submitLabel="Save">
                  <Field name="courier" label="Courier / rider"><Input name="courier" defaultValue={so.courier ?? ""} /></Field>
                  <Field name="trackingNumber" label="Tracking / waybill"><Input name="trackingNumber" defaultValue={so.trackingNumber ?? ""} /></Field>
                  <Field name="collectedBy" label="Collected by"><Input name="collectedBy" defaultValue={so.collectedBy ?? ""} /></Field>
                  <Field name="fulfillmentNotes" label="Notes (shown to the customer)"><Textarea name="fulfillmentNotes" defaultValue={so.fulfillmentNotes ?? ""} /></Field>
                </FormDialog>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>History & audit trail</CardTitle></CardHeader>
            <CardContent>
              <ol className="grid gap-4 border-l border-border pl-4 text-sm">
                {so.events.map((e) => (
                  <li key={e.id} className="relative">
                    <span className={`absolute -left-[21px] top-1.5 size-2.5 rounded-full ${e.kind === "STOCK" ? "bg-warning" : e.kind === "NOTE" ? "bg-muted" : "bg-brand"}`} />
                    <div className="font-medium">
                      {e.kind === "STATUS" || e.kind === "PAYMENT" ? (e.fromStatus ? `${SHOP_STATUS_LABELS[e.fromStatus]} → ${stepLabel(e.toStatus!, so.fulfillmentMethod)}` : stepLabel(e.toStatus ?? so.status, so.fulfillmentMethod)) : e.kind === "FULFILMENT" ? "Fulfilment updated" : e.kind === "STOCK" ? "Stock warning" : "Note"}
                    </div>
                    {e.note && <div className="whitespace-pre-line text-muted">{e.note}</div>}
                    <div className="text-xs text-muted-2">{formatDateTime(e.createdAt, tz)} · {actorName(e.actorId)}</div>
                  </li>
                ))}
              </ol>
              <div className="mt-5">
                <FormDialog trigger="Add internal note" title="Internal note" description="Visible to staff only." action={addShopOrderNoteAction.bind(null, so.id)} submitLabel="Add note">
                  <Field name="note" label="Note"><Textarea name="note" required /></Field>
                </FormDialog>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
