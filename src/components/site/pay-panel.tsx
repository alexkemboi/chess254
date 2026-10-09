"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Smartphone, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { payOrderAction } from "@/actions/commerce";

type Status = "idle" | "starting" | "PROCESSING" | "SUCCESS" | "FAILED" | "CANCELLED" | "EXPIRED" | "PENDING";

/**
 * M-Pesa STK flow. The success screen is shown only after the backend reports
 * the payment settled — the browser never decides that a payment succeeded.
 */
export function PayPanel({ orderId, amountLabel, defaultPhone, inFlightPaymentId, successHref, successLabel }: { orderId: string; amountLabel: string; defaultPhone: string; inFlightPaymentId: string | null; successHref: string; successLabel: string }) {
  const [status, setStatus] = React.useState<Status>(inFlightPaymentId ? "PROCESSING" : "idle");
  const [paymentId, setPaymentId] = React.useState<string | null>(inFlightPaymentId);
  const [reason, setReason] = React.useState<string | null>(null);
  const [receipt, setReceipt] = React.useState<string | null>(null);
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    if (!paymentId || (status !== "PROCESSING" && status !== "PENDING")) return;
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped) return;
      setElapsed(Math.round((Date.now() - started) / 1000));
      try {
        const res = await fetch(`/api/payments/${paymentId}`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { status: Status; receipt: string | null; failureReason: string | null };
          if (data.status === "SUCCESS") {
            setReceipt(data.receipt);
            setStatus("SUCCESS");
            return;
          }
          if (data.status === "FAILED" || data.status === "CANCELLED" || data.status === "EXPIRED") {
            setReason(data.failureReason);
            setStatus(data.status);
            return;
          }
        }
      } catch {
        /* transient network error — keep polling */
      }
      if (Date.now() - started < 4 * 60_000) setTimeout(tick, 3000);
      else setStatus("EXPIRED");
    };
    const t = setTimeout(tick, 2500);
    return () => {
      stopped = true;
      clearTimeout(t);
    };
  }, [paymentId, status]);

  async function submit(formData: FormData) {
    setStatus("starting");
    setReason(null);
    const res = await payOrderAction(orderId, formData);
    if (!res.ok) {
      toast.error(res.error);
      setStatus("idle");
      return;
    }
    toast.success(res.message ?? "Check your phone");
    setPaymentId(res.data?.paymentId ?? null);
    setStatus("PROCESSING");
  }

  if (status === "SUCCESS") {
    return (
      <div className="animate-fade-up text-center">
        <div className="mx-auto grid size-20 place-items-center rounded-full bg-success/15 text-success"><CheckCircle2 className="size-10" /></div>
        <h2 className="mt-6 font-display text-3xl font-extrabold tracking-tight">Payment confirmed</h2>
        <p className="mt-2 text-muted">{amountLabel} received{receipt ? ` · M-Pesa ${receipt}` : ""}. A confirmation is in your notifications.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <Button asChild><Link href={successHref}>{successLabel}</Link></Button>
          <Button asChild variant="secondary"><Link href="/dashboard/payments">Receipts</Link></Button>
        </div>
      </div>
    );
  }

  if (status === "PROCESSING" || status === "PENDING") {
    return (
      <div className="text-center" aria-live="polite">
        <div className="relative mx-auto grid size-24 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-brand/20" />
          <span className="relative grid size-20 place-items-center rounded-full bg-brand text-brand-foreground"><Smartphone className="size-9" /></span>
        </div>
        <h2 className="mt-6 font-display text-2xl font-extrabold tracking-tight">Check your phone</h2>
        <p className="mx-auto mt-2 max-w-sm text-muted">Enter your M-Pesa PIN on the prompt to pay {amountLabel}. This page updates automatically once Safaricom confirms.</p>
        <div className="mt-6 inline-flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin text-brand-ink" />Waiting for confirmation{elapsed ? ` · ${elapsed}s` : "…"}</div>
      </div>
    );
  }

  return (
    <div>
      {(status === "FAILED" || status === "CANCELLED" || status === "EXPIRED") && (
        <div className="mb-6 flex gap-3 rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm">
          <XCircle className="size-5 shrink-0 text-danger" />
          <div>
            <div className="font-semibold">{status === "CANCELLED" ? "Payment cancelled" : status === "EXPIRED" ? "We didn't get a confirmation" : "Payment not completed"}</div>
            <div className="mt-0.5 text-muted">{reason ?? (status === "EXPIRED" ? "If money left your account, it will be reconciled automatically. Otherwise, try again." : "You can try again below.")}</div>
          </div>
        </div>
      )}
      <form action={submit} className="grid gap-4">
        <label htmlFor="phone" className="text-sm font-medium">M-Pesa phone number</label>
        <div className="flex gap-2">
          <span className="grid h-12 place-items-center rounded-xl border border-border bg-surface-2 px-3 text-sm text-muted">🇰🇪</span>
          <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" defaultValue={defaultPhone} required className="h-12 text-base" />
        </div>
        <Button type="submit" size="lg" disabled={status === "starting"} className="w-full bg-[#3bb54a] text-white hover:bg-[#35a343] hover:shadow-none">
          {status === "starting" ? <Loader2 className="animate-spin" /> : null}
          Pay {amountLabel} with M-Pesa
        </Button>
        <p className="text-center text-xs text-muted">You’ll receive an M-Pesa prompt on this number. Your order is confirmed only after M-Pesa confirms the payment.</p>
      </form>
    </div>
  );
}
