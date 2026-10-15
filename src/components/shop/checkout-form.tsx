"use client";
import * as React from "react";
import { Loader2, Lock, Store, Tag, Truck, X } from "lucide-react";
import { Img as Image } from "@/components/ui/img";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { placeOrderAction, quoteCheckoutAction, type QuoteResult } from "@/actions/shop";
import { ProductArt } from "./product-card";
import type { CartLineView } from "./cart-lines";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type Option = { id: string; name: string; method: "DELIVERY" | "COLLECTION"; description: string | null; fee: number; freeAbove: number | null; counties: string[]; estimatedTime: string | null };

export function CheckoutForm({ lines, currency, subtotal, options, counties, checkoutKey, defaults }: { lines: CartLineView[]; currency: string; subtotal: number; options: Option[]; counties: readonly string[]; checkoutKey: string; defaults: { name: string; email: string; phone: string } }) {
  const methods = (["COLLECTION", "DELIVERY"] as const).filter((m) => options.some((o) => o.method === m));
  const [method, setMethod] = React.useState<"DELIVERY" | "COLLECTION">(methods[0] ?? "COLLECTION");
  const forMethod = options.filter((o) => o.method === method);
  const [optionId, setOptionId] = React.useState(forMethod[0]?.id ?? "");
  const [county, setCounty] = React.useState("");
  const [codeInput, setCodeInput] = React.useState("");
  const [code, setCode] = React.useState("");
  const [email, setEmail] = React.useState(defaults.email);
  const [quote, setQuote] = React.useState<QuoteResult | null>(null);
  const quoteKey = JSON.stringify([optionId, method === "DELIVERY" ? county : "", code, email]);
  const [quotedKey, setQuotedKey] = React.useState("");
  const quoting = quotedKey !== quoteKey;
  const chooseMethod = (m: "DELIVERY" | "COLLECTION") => {
    setMethod(m);
    if (options.find((o) => o.id === optionId)?.method !== m) setOptionId(options.find((o) => o.method === m)?.id ?? "");
  };

  React.useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await quoteCheckoutAction({ deliveryOptionId: optionId || undefined, county: method === "DELIVERY" ? county : undefined, discountCode: code || undefined, email: email || undefined });
      if (cancelled) return;
      setQuotedKey(quoteKey);
      if (res.ok && res.data) setQuote(res.data);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [optionId, county, code, email, method, quoteKey]);

  const selected = options.find((o) => o.id === optionId);
  const served = (o: Option) => o.method === "COLLECTION" || !o.counties.length || (county && o.counties.includes(county));

  const section = "rounded-3xl border border-border bg-surface p-5 sm:p-7";
  const step = (n: number, title: string) => (
    <h2 className="mb-5 flex items-center gap-3 font-display text-xl font-extrabold tracking-tight"><span className="grid size-8 place-items-center rounded-full bg-brand text-sm text-brand-foreground">{n}</span>{title}</h2>
  );

  return (
    <ActionForm action={placeOrderAction} successMessage={false} className="grid gap-6 lg:grid-cols-[1fr_400px] lg:items-start">
      <input type="hidden" name="checkoutKey" value={checkoutKey} />
      <input type="hidden" name="method" value={method} />
      <input type="hidden" name="discountCode" value={code} />
      <div className="grid min-w-0 gap-6">
        <section className={section}>
          {step(1, "Your details")}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="name" label="Full name" className="sm:col-span-2"><Input id="name" name="name" autoComplete="name" defaultValue={defaults.name} required /></Field>
            <Field name="email" label="Email" hint="Your receipt and order updates go here."><Input id="email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Field name="phone" label="Phone number"><Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" defaultValue={defaults.phone} required /></Field>
          </div>
        </section>

        <section className={section}>
          {step(2, "Delivery or collection")}
          {methods.length > 1 && (
            <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl bg-surface-2 p-1.5" role="radiogroup" aria-label="Fulfilment method">
              {methods.map((m) => (
                <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => chooseMethod(m)} className={cn("flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition", method === m ? "bg-surface text-foreground shadow" : "text-muted hover:text-foreground")}>
                  {m === "COLLECTION" ? <Store className="size-4" /> : <Truck className="size-4" />}{m === "COLLECTION" ? "Pick up" : "Delivery"}
                </button>
              ))}
            </div>
          )}
          {method === "DELIVERY" && (
            <div className="mb-5 grid gap-4 sm:grid-cols-2">
              <Field name="county" label="County">
                <Select id="county" name="county" value={county} onChange={(e) => setCounty(e.target.value)} required>
                  <option value="">Choose county</option>
                  {counties.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field name="town" label="Town / area"><Input id="town" name="town" autoComplete="address-level2" placeholder="e.g. Westlands" required /></Field>
              <Field name="address" label="Delivery address" className="sm:col-span-2"><Input id="address" name="address" autoComplete="street-address" placeholder="Building, street, house / office number" required /></Field>
            </div>
          )}
          <Field name="deliveryOptionId" label={method === "COLLECTION" ? "Pick-up point" : "Delivery option"}>
            <div className="grid gap-2">
              {forMethod.map((o) => {
                const ok = served(o);
                return (
                  <label key={o.id} className={cn("flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition", optionId === o.id ? "border-brand bg-brand-soft" : "border-border hover:border-border-strong", !ok && "opacity-50")}>
                    <input type="radio" name="deliveryOptionId" value={o.id} checked={optionId === o.id} onChange={() => setOptionId(o.id)} disabled={!ok} className="mt-1 size-4 accent-[var(--brand)]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-3">
                        <span className="font-semibold">{o.name}</span>
                        <span className="shrink-0 font-mono text-sm">{o.fee > 0 ? formatMoney(o.fee, currency) : "Free"}</span>
                      </span>
                      {o.description && <span className="mt-0.5 block text-sm text-muted">{o.description}</span>}
                      <span className="mt-1 block text-xs text-muted">
                        {[o.estimatedTime, o.freeAbove !== null && o.fee > 0 ? `Free over ${formatMoney(o.freeAbove, currency)}` : null, !ok ? (county ? `Not available in ${county}` : "Choose your county first") : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </label>
                );
              })}
              {!forMethod.length && <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted">No options are available right now. Please contact the club.</p>}
            </div>
          </Field>
          <Field name="instructions" label="Instructions (optional)" className="mt-4"><Textarea id="instructions" name="instructions" placeholder={method === "COLLECTION" ? "Anything we should know?" : "Gate code, landmark, best time to deliver…"} className="min-h-20" /></Field>
        </section>
      </div>

      <aside className="min-w-0 lg:sticky lg:top-24">
        <div className={section}>
          {step(3, "Review & pay")}
          <ul className="grid gap-3">
            {lines.map((l) => (
              <li key={l.id} className="flex items-center gap-3">
                <span className="relative size-14 shrink-0 overflow-hidden rounded-xl border border-border bg-white">
                  {l.image ? <Image src={l.image} alt="" fill sizes="56px" className="object-cover" /> : <ProductArt />}
                  <span className="absolute -right-0 -top-0 grid min-w-5 place-items-center rounded-bl-lg bg-foreground px-1 text-[11px] font-bold text-background">{l.quantity}</span>
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="line-clamp-1 font-medium">{l.name}</span>
                  {l.variantName && <span className="block text-xs text-muted">{l.variantName}</span>}
                  <span className="block text-xs text-muted">{l.quantity} × {formatMoney(l.unitPrice, currency)}</span>
                </span>
                <span className="font-mono text-sm">{formatMoney(l.lineTotal, currency)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-5 border-t border-border pt-5">
            {code ? (
              <div className="flex items-center justify-between rounded-xl bg-brand-soft px-3 py-2 text-sm">
                <span className="flex items-center gap-2 font-semibold text-brand-ink"><Tag className="size-4" />{code}</span>
                <button type="button" onClick={() => { setCode(""); setCodeInput(""); }} className="text-muted hover:text-foreground" aria-label="Remove discount code"><X className="size-4" /></button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())} placeholder="Discount code" aria-label="Discount code" className="h-10 font-mono uppercase" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setCode(codeInput.trim()); } }} />
                <Button type="button" variant="secondary" size="sm" className="h-10" onClick={() => setCode(codeInput.trim())} disabled={!codeInput.trim()}>Apply</Button>
              </div>
            )}
            {code && quote?.discountError && <p className="mt-2 text-xs text-danger">{quote.discountError}</p>}
          </div>

          <dl className="mt-5 grid gap-2 text-sm" aria-live="polite">
            <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="font-mono">{formatMoney(quote?.subtotal ?? subtotal, currency)}</dd></div>
            {(quote?.discountAmount ?? 0) > 0 && <div className="flex justify-between text-brand-ink"><dt>Discount ({quote!.discountCode})</dt><dd className="font-mono">−{formatMoney(quote!.discountAmount, currency)}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted">{method === "COLLECTION" ? "Collection" : "Delivery"}</dt><dd className="font-mono">{!selected ? "—" : quote?.deliveryError ? "—" : (quote?.deliveryFee ?? 0) > 0 ? formatMoney(quote!.deliveryFee, currency) : "Free"}</dd></div>
            <div className="mt-2 flex items-center justify-between border-t border-border pt-4 text-lg font-bold"><dt>Total</dt><dd className="flex items-center gap-2 font-mono">{quoting && <Loader2 className="size-4 animate-spin text-muted" />}{formatMoney(quote?.total ?? subtotal, currency)}</dd></div>
          </dl>
          {method === "DELIVERY" && quote?.deliveryError && county && <p className="mt-2 text-xs text-danger">{quote.deliveryError}</p>}

          <SubmitButton size="lg" className="mt-6 w-full bg-[#3bb54a] text-white hover:bg-[#35a343] hover:shadow-none" pendingLabel="Placing order…">
            <Lock />Place order · {formatMoney(quote?.total ?? subtotal, currency)}
          </SubmitButton>
          <p className="mt-3 text-center text-xs text-muted">Next you&apos;ll pay with M-Pesa. Your items are held for you while you pay; the order is confirmed once Safaricom confirms the payment.</p>
        </div>
      </aside>
    </ActionForm>
  );
}
