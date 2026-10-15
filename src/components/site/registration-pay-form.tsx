"use client";
import * as React from "react";
import { toast } from "sonner";
import { Check, Loader2, Smartphone } from "lucide-react";
import { PayPanel } from "@/components/site/pay-panel";
import { mpesaRegistrationAction } from "@/actions/event-forms";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type Item = { id: string; label: string; dates: string; price: number; deadline: string | null; overdue: boolean };
type Started = { orderId: string; orderKey: string; paymentId: string; amountLabel: string };

/**
 * Pay some or all unpaid weeks by M-Pesa STK push from the booking page.
 * Once the prompt is sent, PayPanel polls the backend for the verified result;
 * retries reuse the same order, so the registration is never duplicated.
 */
export function RegistrationPayForm({ reference, accessKey, items, currency, defaultPhone, email, bookingHref }: { reference: string; accessKey: string; items: Item[]; currency: string; defaultPhone: string; email: string; bookingHref: string }) {
  const [selected, setSelected] = React.useState(() => new Set(items.map((i) => i.id)));
  const [phone, setPhone] = React.useState(defaultPhone);
  const [phoneError, setPhoneError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [started, setStarted] = React.useState<Started | null>(null);
  const [paid, setPaid] = React.useState(false);
  const total = items.filter((i) => selected.has(i.id)).reduce((s, i) => s + i.price, 0);
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  async function pay() {
    if (busy || !selected.size) return;
    setBusy(true);
    setPhoneError(null);
    const res = await mpesaRegistrationAction(reference, accessKey, [...selected], phone).catch(() => null);
    setBusy(false);
    if (!res) return toast.error("Network error — nothing was charged. Please try again.");
    if (!res.ok) {
      if (res.fieldErrors?.phone) setPhoneError(res.fieldErrors.phone);
      return toast.error(res.error);
    }
    toast.success(res.message ?? "Check your phone");
    setStarted(res.data!);
  }

  if (started) {
    return (
      <div className="grid gap-4">
        <PayPanel orderId={started.orderId} amountLabel={started.amountLabel} defaultPhone={phone} inFlightPaymentId={started.paymentId} successHref={bookingHref} successLabel="View updated booking" guest={{ orderKey: started.orderKey, email, booking: true }} onSettled={() => setPaid(true)} />
        {!paid && <button type="button" onClick={() => setStarted(null)} className="mx-auto min-h-11 text-sm font-semibold text-muted underline-offset-4 hover:text-foreground hover:underline">Change weeks or number</button>}
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-semibold">What would you like to pay for?</legend>
        {items.map((i) => {
          const on = selected.has(i.id);
          return (
            <label key={i.id} className={cn("flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 transition-colors", on ? "border-brand bg-brand-soft/50" : "border-border bg-surface")}>
              <input type="checkbox" checked={on} onChange={() => toggle(i.id)} className="size-5 shrink-0 accent-[var(--brand)]" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold leading-tight">{i.label}</span>
                <span className="block text-xs text-muted">{i.dates}</span>
                {i.deadline && <span className={cn("block text-xs font-semibold", i.overdue ? "text-danger" : "text-muted")}>{i.overdue ? "Overdue — was due" : "Pay by"} {i.deadline}</span>}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{formatMoney(i.price, currency)}</span>
            </label>
          );
        })}
      </fieldset>
      <div className="grid gap-2">
        <label htmlFor="mpesa-phone" className="text-sm font-semibold">M-Pesa number</label>
        <div className="flex gap-2">
          <span className="grid h-14 place-items-center rounded-2xl border border-border bg-surface-2 px-3 text-sm text-muted">🇰🇪</span>
          <input id="mpesa-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" aria-invalid={Boolean(phoneError)} className="h-14 w-full rounded-2xl border border-border bg-surface px-4 text-base outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 aria-[invalid=true]:border-danger" />
        </div>
        {phoneError ? <p className="text-sm font-medium text-danger">{phoneError}</p> : <p className="text-xs text-muted">We&apos;ll send a payment prompt to this phone. Enter your M-Pesa PIN to approve it.</p>}
      </div>
      <button type="button" onClick={pay} disabled={busy || !selected.size} className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#3bb54a] px-5 text-base font-bold text-white transition hover:bg-[#35a343] disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? <Loader2 className="size-5 animate-spin" /> : <Smartphone className="size-5" />}
        {selected.size ? `Pay ${formatMoney(total, currency)} with M-Pesa` : "Tick a week to pay for"}
      </button>
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted"><Check className="size-3.5 text-brand-ink" />Weeks are only marked paid after Safaricom confirms the payment.</p>
    </div>
  );
}
