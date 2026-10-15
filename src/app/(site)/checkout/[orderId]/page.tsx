import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, Mail, ShieldCheck } from "lucide-react";
import { prisma } from "@/server/db";
import { activeProvider } from "@/server/payments/registry";
import { getAllSettings } from "@/server/settings";
import { isPendingAccount, isRegistrationOrder, verifyGuestOrderKey } from "@/server/account-setup";
import { registrationPath } from "@/server/event-registrations";
import { Container } from "@/components/site/cards";
import { PayPanel } from "@/components/site/pay-panel";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { formatDateTime, formatMoney } from "@/lib/format";
import { nowMs } from "@/lib/time";

export const metadata = { title: "Payment", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Pay-first checkout for visitors without an account; access is proven by the signed key in the link. */
export default async function GuestCheckoutPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ k?: string }> }) {
  const { orderId } = await params;
  const { k } = await searchParams;
  if (!k || !verifyGuestOrderKey(orderId, k)) notFound();
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { user: true, items: { include: { eventRegistrationItem: { include: { registration: { select: { reference: true } } } } } }, payments: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!order) notFound();
  const eventReference = isRegistrationOrder(order) ? order.items[0].eventRegistrationItem?.registration.reference : null;
  if (!eventReference && !isPendingAccount(order.user)) redirect(`/pay/${order.id}`);
  const bookingHref = eventReference ? registrationPath(eventReference) : null;
  const settings = await getAllSettings();
  const provider = await activeProvider();
  const ready = provider ? (await provider.impl.readiness()).ready : false;
  const config = provider ? await prisma.paymentConfiguration.findUnique({ where: { providerId: provider.row.id } }) : null;
  const latest = order.payments[0];
  const inFlight = latest && latest.status === "PROCESSING" && latest.createdAt.getTime() > nowMs() - (config?.timeoutMinutes ?? 5) * 60_000 ? latest.id : null;
  const expired = order.status === "PENDING" && order.expiresAt && order.expiresAt < new Date() && !inFlight;
  const amount = formatMoney(Math.ceil(order.total.toNumber()), order.currency);

  return (
    <Container className="max-w-5xl py-12 sm:py-20">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <section className="min-w-0 rounded-3xl border border-border bg-surface p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <div className="eyebrow">Order {order.number}</div>
            <StatusBadge status={expired ? "EXPIRED" : order.status} />
          </div>
          <ul className="mt-6 divide-y divide-border">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-4 py-4">
                <div className="font-semibold">{item.description}</div>
                <div className="font-mono text-sm">{formatMoney(item.total, order.currency)}</div>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-between border-t border-border pt-4 text-lg font-bold"><span>Total</span><span className="font-mono">{amount}</span></div>
          <div className="mt-6 grid gap-2 rounded-2xl bg-surface-2 p-4 text-sm">
            <div className="flex items-start gap-2 font-semibold"><Mail className="mt-0.5 size-4 shrink-0 text-brand-ink" /><span className="min-w-0 break-all">{order.user.name} · {order.user.email}</span></div>
            <p className="text-muted">{bookingHref ? "Your booking updates as soon as M-Pesa confirms the payment, and we email you a receipt." : "After M-Pesa confirms your payment, we email you a link to choose your password. Your membership is active straight away."}</p>
            {bookingHref && <Link href={bookingHref} className="text-sm font-semibold text-brand-ink hover:underline">← Back to your booking</Link>}
          </div>
          {order.status === "PENDING" && order.expiresAt && !expired && <p className="mt-6 text-xs text-muted">Held until {formatDateTime(order.expiresAt, settings.general.timezone)}</p>}
          <p className="mt-3 flex items-center gap-2 text-xs text-muted"><ShieldCheck className="size-3.5 text-brand-ink" />Payments are verified with Safaricom before anything is activated.</p>
        </section>

        <section className="min-w-0 rounded-3xl border border-border bg-surface p-6 sm:p-8">
          {order.status === "PAID" ? (
            <div className="text-center">
              <h1 className="font-display text-3xl font-extrabold tracking-tight">Payment confirmed</h1>
              <p className="mt-2 text-muted">{latest?.receiptNumber ? `M-Pesa receipt ${latest.receiptNumber}. ` : ""}{bookingHref ? "Your booking has been updated." : <>Check <span className="break-all">{order.user.email}</span> for your registration link.</>}</p>
              {bookingHref ? <Button asChild className="mt-6"><Link href={bookingHref}>View booking</Link></Button> : <Button asChild variant="secondary" className="mt-6"><Link href="/complete-registration">Resend registration link</Link></Button>}
            </div>
          ) : order.status !== "PENDING" || expired ? (
            <div className="text-center">
              <AlertTriangle className="mx-auto size-10 text-warning" />
              <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight">This order is closed</h1>
              <p className="mt-2 text-muted">The payment window passed. Start again whenever you are ready.</p>
              <Button asChild className="mt-6"><Link href={bookingHref ?? "/memberships"}>{bookingHref ? "Back to booking" : "Start again"}</Link></Button>
            </div>
          ) : !ready ? (
            <div className="text-center">
              <AlertTriangle className="mx-auto size-10 text-warning" />
              <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight">Online payment unavailable</h1>
              <p className="mt-2 text-muted">M-Pesa payments are not switched on right now. Please contact the club.</p>
              <Button asChild variant="secondary" className="mt-6"><Link href="/contact">Contact the club</Link></Button>
            </div>
          ) : (
            <>
              <h1 className="mb-6 font-display text-3xl font-extrabold tracking-tight">Pay with M-Pesa</h1>
              <PayPanel orderId={order.id} amountLabel={amount} defaultPhone={order.user.phone ?? ""} inFlightPaymentId={inFlight} successHref={bookingHref ?? "/complete-registration"} successLabel={bookingHref ? "View booking" : "Registration"} guest={{ orderKey: k, email: order.user.email, booking: Boolean(bookingHref) }} />
            </>
          )}
        </section>
      </div>
    </Container>
  );
}
