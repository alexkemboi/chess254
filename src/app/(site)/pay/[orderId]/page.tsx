import Link from "next/link";
import { nowMs } from "@/lib/time";
import { notFound } from "next/navigation";
import { AlertTriangle, Clock, ShieldCheck } from "lucide-react";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { activeProvider } from "@/server/payments/registry";
import { getAllSettings } from "@/server/settings";
import { Container } from "@/components/site/cards";
import { PayPanel } from "@/components/site/pay-panel";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { CancelOrderButton } from "@/components/site/cancel-order-button";
import { formatDateTime, formatMoney } from "@/lib/format";

export const metadata = { title: "Payment", robots: { index: false } };

export default async function PayPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const user = await requireUser(`/pay/${orderId}`);
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: user.id },
    include: { items: { include: { booking: true, eventRegistration: { include: { event: true } } } }, payments: { orderBy: { createdAt: "desc" }, take: 1 }, invoice: true },
  });
  if (!order) notFound();
  const settings = await getAllSettings();
  const provider = await activeProvider();
  const ready = provider ? (await provider.impl.readiness()).ready : false;
  const latest = order.payments[0];
  const config = provider ? await prisma.paymentConfiguration.findUnique({ where: { providerId: provider.row.id } }) : null;
  const inFlight = latest && latest.status === "PROCESSING" && latest.createdAt.getTime() > nowMs() - (config?.timeoutMinutes ?? 5) * 60_000 ? latest.id : null;
  const expired = order.status === "PENDING" && order.expiresAt && order.expiresAt < new Date() && !inFlight;
  const amount = formatMoney(Math.ceil(order.total.toNumber()), order.currency);
  const first = order.items[0];
  const success =
    first?.type === "MEMBERSHIP" ? { href: "/dashboard/membership", label: "View membership" } :
    first?.type === "BOOKING" ? { href: "/dashboard/bookings", label: "View booking" } :
    first?.type === "EVENT" ? { href: "/dashboard/events", label: "View registration" } :
    { href: "/dashboard/passes", label: "View pass" };

  return (
    <Container className="max-w-5xl py-12 sm:py-20">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <section className="rounded-3xl border border-border bg-surface p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <div className="eyebrow">Order {order.number}</div>
            <StatusBadge status={expired ? "EXPIRED" : order.status} />
          </div>
          <ul className="mt-6 divide-y divide-border">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-4 py-4">
                <div>
                  <div className="font-semibold">{item.description}</div>
                  <div className="text-xs text-muted">{item.type.toLowerCase()}{item.quantity > 1 ? ` × ${item.quantity}` : ""}</div>
                </div>
                <div className="font-mono text-sm">{formatMoney(item.total, order.currency)}</div>
              </li>
            ))}
          </ul>
          <dl className="mt-2 grid gap-2 border-t border-border pt-4 text-sm">
            {order.tax.greaterThan(0) && (
              <>
                <div className="flex justify-between text-muted"><dt>Subtotal</dt><dd className="font-mono">{formatMoney(order.subtotal, order.currency)}</dd></div>
                <div className="flex justify-between text-muted"><dt>{settings.payments.taxLabel}{settings.payments.taxInclusive ? " (included)" : ""}</dt><dd className="font-mono">{formatMoney(order.tax, order.currency)}</dd></div>
              </>
            )}
            <div className="flex justify-between text-lg font-bold"><dt>Total</dt><dd className="font-mono">{amount}</dd></div>
          </dl>
          {order.status === "PENDING" && order.expiresAt && !expired && (
            <p className="mt-6 flex items-center gap-2 text-xs text-muted"><Clock className="size-3.5 text-brand" />Held for you until {formatDateTime(order.expiresAt, settings.general.timezone)}</p>
          )}
          <p className="mt-3 flex items-center gap-2 text-xs text-muted"><ShieldCheck className="size-3.5 text-brand" />Payments are verified with Safaricom before anything is activated.</p>
        </section>

        <section className="rounded-3xl border border-border bg-surface p-6 sm:p-8">
          {order.status === "PAID" ? (
            <div className="text-center">
              <h1 className="font-display text-3xl font-extrabold tracking-tight">Payment confirmed</h1>
              <p className="mt-2 text-muted">{latest?.receiptNumber ? `M-Pesa receipt ${latest.receiptNumber}. ` : ""}Your order is confirmed.</p>
              <div className="mt-8 flex flex-wrap justify-center gap-2">
                <Button asChild><Link href={success.href}>{success.label}</Link></Button>
                {order.invoice && <Button asChild variant="secondary"><Link href={`/invoices/${order.invoice.number}`}>Invoice</Link></Button>}
              </div>
            </div>
          ) : order.status !== "PENDING" || expired ? (
            <div className="text-center">
              <AlertTriangle className="mx-auto size-10 text-warning" />
              <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight">This order is closed</h1>
              <p className="mt-2 text-muted">{expired || order.status === "EXPIRED" ? "The payment window passed and any held slot was released." : "This order was cancelled."} Start again whenever you’re ready.</p>
              <Button asChild className="mt-6"><Link href={first?.type === "MEMBERSHIP" ? "/memberships" : first?.type === "EVENT" ? "/events" : first?.type === "BOOKING" ? "/book" : "/memberships"}>Start again</Link></Button>
            </div>
          ) : !ready ? (
            <div className="text-center">
              <AlertTriangle className="mx-auto size-10 text-warning" />
              <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight">Online payment unavailable</h1>
              <p className="mt-2 text-muted">M-Pesa payments are not switched on right now. Please contact the club to complete this order.</p>
              <Button asChild variant="secondary" className="mt-6"><Link href="/contact">Contact the club</Link></Button>
            </div>
          ) : (
            <>
              <h1 className="mb-6 font-display text-3xl font-extrabold tracking-tight">Pay with M-Pesa</h1>
              <PayPanel orderId={order.id} amountLabel={amount} defaultPhone={user.phone ?? ""} inFlightPaymentId={inFlight} successHref={success.href} successLabel={success.label} />
              {!inFlight && <CancelOrderButton orderId={order.id} />}
            </>
          )}
        </section>
      </div>
    </Container>
  );
}
