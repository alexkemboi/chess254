import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Check, MapPin, Package, ShieldCheck, Store, Truck } from "lucide-react";
import { prisma } from "@/server/db";
import { getAllSettings } from "@/server/settings";
import { activeProvider } from "@/server/payments/registry";
import { guestOrderKey } from "@/server/account-setup";
import { shopOrderPath, verifyShopOrderKey } from "@/server/shop/links";
import { Container } from "@/components/site/cards";
import { PayPanel } from "@/components/site/pay-panel";
import { ActionButton } from "@/components/admin/admin-ui";
import { ProductArt } from "@/components/shop/product-card";
import { Img as Image } from "@/components/ui/img";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { cancelShopOrderAction } from "@/actions/shop";
import { formatDateTime, formatMoney } from "@/lib/format";
import { progressSteps, SHOP_STATUS_LABELS, stepLabel } from "@/lib/shop";
import { nowMs } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Your order", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Customer order page. Access is proven by the signed key in the link (works for guests and members). */
export default async function ShopOrderPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ k?: string }> }) {
  const { number } = await params;
  const { k } = await searchParams;
  if (!verifyShopOrderKey(number, k)) notFound();
  const so = await prisma.shopOrder.findUnique({
    where: { number },
    include: { items: true, order: { include: { payments: { orderBy: { createdAt: "desc" } } } }, events: { where: { kind: { in: ["STATUS", "PAYMENT"] } }, orderBy: { createdAt: "asc" } } },
  });
  if (!so) notFound();
  const settings = await getAllSettings();
  const tz = settings.general.timezone;
  const provider = await activeProvider();
  const ready = provider ? (await provider.impl.readiness()).ready : false;
  const config = provider ? await prisma.paymentConfiguration.findUnique({ where: { providerId: provider.row.id } }) : null;
  const latest = so.order.payments[0];
  const paid = so.order.payments.find((p) => p.status === "SUCCESS");
  const inFlight = latest && latest.status === "PROCESSING" && latest.createdAt.getTime() > nowMs() - (config?.timeoutMinutes ?? 5) * 60_000 ? latest.id : null;
  const lapsed = so.status === "PENDING_PAYMENT" && so.order.expiresAt !== null && so.order.expiresAt < new Date() && !inFlight;
  const payable = so.status === "PENDING_PAYMENT" && so.order.status === "PENDING" && !lapsed;
  const amount = formatMoney(Math.ceil(so.total.toNumber()), so.currency);
  const steps = progressSteps(so.fulfillmentMethod);
  const reached = so.status === "CANCELLED" || so.status === "REFUNDED" ? -1 : steps.indexOf(so.status);

  return (
    <Container className="max-w-6xl py-10 sm:py-14">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Order {so.number}</div>
          <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            {so.status === "PENDING_PAYMENT" ? (lapsed ? "Payment window closed" : "Complete your payment") : so.status === "CANCELLED" ? "Order cancelled" : so.status === "REFUNDED" ? "Order refunded" : `Thank you, ${so.customerName.split(" ")[0]}!`}
          </h1>
          <p className="mt-1 text-sm text-muted">Placed {formatDateTime(so.createdAt, tz)}</p>
        </div>
        <StatusBadge status={lapsed ? "EXPIRED" : so.status} />
      </div>

      {reached >= 0 && (
        <ol className="mb-8 grid grid-cols-5 gap-1 rounded-3xl border border-border bg-surface p-4 sm:p-6" aria-label="Order progress">
          {steps.map((s, i) => (
            <li key={s} className="flex flex-col items-center gap-2 text-center">
              <span className={cn("relative grid size-9 place-items-center rounded-full border-2 text-sm font-bold", i <= reached ? "border-brand bg-brand text-brand-foreground" : "border-border text-muted")} aria-current={i === reached ? "step" : undefined}>
                {i < reached || (i === reached && i === steps.length - 1) ? <Check className="size-4" /> : i + 1}
              </span>
              <span className={cn("text-[11px] leading-tight sm:text-xs", i <= reached ? "font-semibold text-foreground" : "text-muted")}>{stepLabel(s, so.fulfillmentMethod)}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <section className="min-w-0 rounded-3xl border border-border bg-surface p-5 sm:p-7">
          <h2 className="flex items-center gap-2 font-display text-xl font-extrabold tracking-tight"><Package className="size-5 text-brand-ink" />Items</h2>
          <ul className="mt-4 divide-y divide-border">
            {so.items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-3">
                <span className="relative size-16 shrink-0 overflow-hidden rounded-xl border border-border bg-white">{i.imageUrl ? <Image src={i.imageUrl} alt="" fill sizes="64px" className="object-cover" /> : <ProductArt />}</span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="line-clamp-2 font-semibold">{i.productName}</span>
                  {i.variantName && <span className="block text-xs text-muted">{i.variantName}</span>}
                  <span className="block text-xs text-muted">{i.quantity} × {formatMoney(i.unitPrice, so.currency)}</span>
                </span>
                <span className="font-mono text-sm">{formatMoney(i.total, so.currency)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-2 grid gap-2 border-t border-border pt-4 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="font-mono">{formatMoney(so.subtotal, so.currency)}</dd></div>
            {so.discountTotal.greaterThan(0) && <div className="flex justify-between text-brand-ink"><dt>Discount{so.discountCode ? ` (${so.discountCode})` : ""}</dt><dd className="font-mono">−{formatMoney(so.discountTotal, so.currency)}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted">{so.fulfillmentMethod === "COLLECTION" ? "Collection" : "Delivery"}</dt><dd className="font-mono">{so.deliveryFee.greaterThan(0) ? formatMoney(so.deliveryFee, so.currency) : "Free"}</dd></div>
            {so.tax.greaterThan(0) && <div className="flex justify-between"><dt className="text-muted">Includes {settings.payments.taxLabel}</dt><dd className="font-mono">{formatMoney(so.tax, so.currency)}</dd></div>}
            <div className="mt-1 flex justify-between text-lg font-bold"><dt>Total</dt><dd className="font-mono">{formatMoney(so.total, so.currency)}</dd></div>
          </dl>

          <div className="mt-6 grid gap-3 rounded-2xl bg-surface-2 p-4 text-sm">
            <div className="flex gap-3">
              {so.fulfillmentMethod === "COLLECTION" ? <Store className="mt-0.5 size-4 shrink-0 text-brand-ink" /> : <Truck className="mt-0.5 size-4 shrink-0 text-brand-ink" />}
              <div>
                <div className="font-semibold">{so.deliveryOptionName}</div>
                {so.fulfillmentMethod === "DELIVERY" && <div className="flex items-start gap-1 text-muted"><MapPin className="mt-0.5 size-3.5 shrink-0" />{[so.address, so.town, so.county].filter(Boolean).join(", ")}</div>}
                {so.deliveryInstructions && <div className="mt-1 text-muted">“{so.deliveryInstructions}”</div>}
                {so.courier && <div className="mt-1">Courier: <span className="font-medium">{so.courier}</span></div>}
                {so.trackingNumber && <div>Tracking: <span className="font-mono">{so.trackingNumber}</span></div>}
                {so.fulfillmentNotes && <div className="mt-1 whitespace-pre-line text-muted">{so.fulfillmentNotes}</div>}
              </div>
            </div>
            <div className="text-muted">{so.customerName} · <span className="break-all">{so.customerEmail}</span> · {so.customerPhone}</div>
          </div>
        </section>

        <section className="min-w-0 rounded-3xl border border-border bg-surface p-5 sm:p-7">
          {payable && ready ? (
            <>
              <h2 className="mb-2 font-display text-2xl font-extrabold tracking-tight">Pay with M-Pesa</h2>
              {so.order.expiresAt && <p className="mb-6 text-sm text-muted">Your items are held until {formatDateTime(so.order.expiresAt, tz)}.</p>}
              <PayPanel orderId={so.orderId} amountLabel={amount} defaultPhone={so.customerPhone} inFlightPaymentId={inFlight} successHref={shopOrderPath(so.number)} successLabel="View order" guest={{ orderKey: guestOrderKey(so.orderId), email: so.customerEmail, booking: true }} />
              {!inFlight && <div className="mt-6 border-t border-border pt-4 text-center"><ActionButton action={cancelShopOrderAction.bind(null, so.number, k!)} variant="ghost" confirm="Cancel this order? The items are released.">Cancel order</ActionButton></div>}
            </>
          ) : payable && !ready ? (
            <div className="text-center">
              <AlertTriangle className="mx-auto size-10 text-warning" />
              <h2 className="mt-4 font-display text-2xl font-extrabold tracking-tight">Online payment unavailable</h2>
              <p className="mt-2 text-muted">M-Pesa payments are not switched on right now. Please contact the club with your order number.</p>
              <Button asChild variant="secondary" className="mt-6"><Link href="/contact">Contact the club</Link></Button>
            </div>
          ) : so.status === "PENDING_PAYMENT" || (so.status === "CANCELLED" && !so.paidAt) ? (
            <div className="text-center">
              <AlertTriangle className="mx-auto size-10 text-warning" />
              <h2 className="mt-4 font-display text-2xl font-extrabold tracking-tight">{so.status === "CANCELLED" ? "This order was cancelled" : "The payment window has closed"}</h2>
              <p className="mt-2 text-muted">{so.cancelReason ?? "We didn't receive a payment in time, so the items were released."} If money left your M-Pesa account, it will be reconciled automatically.</p>
              <Button asChild className="mt-6"><Link href="/shop/cart">Back to cart</Link></Button>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3">
                <span className="grid size-12 place-items-center rounded-full bg-success/15 text-success"><Check className="size-6" /></span>
                <div>
                  <h2 className="font-display text-xl font-extrabold tracking-tight">{so.status === "REFUNDED" ? "Refunded" : "Payment confirmed"}</h2>
                  <p className="text-sm text-muted">{paid?.receiptNumber ? `M-Pesa receipt ${paid.receiptNumber}` : so.paidAt ? `Paid ${formatDateTime(so.paidAt, tz)}` : ""}{so.refundReference ? ` · Refund ref ${so.refundReference}` : ""}</p>
                </div>
              </div>
              <p className="mt-4 text-sm text-muted">We email {so.customerEmail} at every step. {so.fulfillmentMethod === "COLLECTION" ? "We'll tell you when it's ready to pick up." : "We'll tell you when it's dispatched."}</p>
            </div>
          )}

          {so.events.length > 0 && (
            <div className="mt-8 border-t border-border pt-6">
              <h3 className="mb-3 text-sm font-semibold">Order history</h3>
              <ol className="grid gap-3 border-l border-border pl-4 text-sm">
                {so.events.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-brand" />
                    <div className="font-medium">{e.toStatus ? stepLabel(e.toStatus, so.fulfillmentMethod) : SHOP_STATUS_LABELS[so.status]}</div>
                    <div className="text-xs text-muted">{formatDateTime(e.createdAt, tz)}</div>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <p className="mt-6 flex items-center gap-2 text-xs text-muted"><ShieldCheck className="size-3.5 text-brand-ink" />Orders are marked paid only after Safaricom confirms the payment.</p>
        </section>
      </div>
    </Container>
  );
}
