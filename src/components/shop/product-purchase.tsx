"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Minus, Plus, ShoppingBag, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addToCartAction } from "@/actions/shop";
import { Price } from "./product-card";
import { cn } from "@/lib/utils";

type Variant = { id: string; sku: string; options: Record<string, string>; price: number; regularPrice: number; available: number; low: boolean };
type Attribute = { name: string; values: { value: string; colorHex: string | null }[] };

/** Variant picker, live price / availability and add-to-cart. Stock and price are re-checked on the server. */
export function ProductPurchase({ variants, attributes, currency, maxQuantity }: { variants: Variant[]; attributes: Attribute[]; currency: string; maxQuantity: number }) {
  const router = useRouter();
  const firstInStock = variants.find((v) => v.available > 0) ?? variants[0];
  const [selected, setSelected] = React.useState<Record<string, string>>(attributes.length ? { ...(firstInStock?.options ?? {}) } : {});
  const [wantedQty, setQty] = React.useState(1);
  const [busy, setBusy] = React.useState<"add" | "buy" | null>(null);
  const [added, setAdded] = React.useState(false);

  const variant = attributes.length ? variants.find((v) => attributes.every((a) => v.options[a.name] === selected[a.name])) : variants[0];
  const prices = variants.map((v) => v.price);
  const limit = variant ? Math.min(variant.available, maxQuantity) : 0;

  const qty = Math.max(1, Math.min(wantedQty, limit || 1));

  /** A value is sold out when no in-stock variant has it together with the other current choices. */
  const valueState = (attr: string, value: string) => {
    const matches = variants.filter((v) => v.options[attr] === value && attributes.every((a) => a.name === attr || !selected[a.name] || v.options[a.name] === selected[a.name]));
    if (!matches.length) return "none";
    return matches.some((v) => v.available > 0) ? "ok" : "soldout";
  };

  async function add(buyNow: boolean) {
    if (!variant) return;
    setBusy(buyNow ? "buy" : "add");
    const res = await addToCartAction(variant.id, qty);
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if (buyNow) {
      router.push("/shop/checkout");
      return;
    }
    setAdded(true);
    setTimeout(() => setAdded(false), 2200);
    toast.success(res.message, { action: { label: "View cart", onClick: () => router.push("/shop/cart") } });
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <div>
        {variant ? <Price price={variant.price} regularPrice={variant.regularPrice} currency={currency} size="lg" /> : <Price price={Math.min(...prices)} regularPrice={Math.min(...prices)} currency={currency} from size="lg" />}
        <div className="mt-2 text-sm" aria-live="polite">
          {!variant ? <span className="text-muted">Choose your options</span> : variant.available <= 0 ? <span className="font-semibold text-danger">Sold out</span> : variant.low ? <span className="font-semibold text-warning">Only {variant.available} left</span> : <span className="flex items-center gap-1.5 font-semibold text-success"><Check className="size-4" />In stock</span>}
          {variant && <span className="ml-3 font-mono text-xs text-muted">SKU {variant.sku}</span>}
        </div>
      </div>

      {attributes.map((attr) => (
        <fieldset key={attr.name}>
          <legend className="mb-2.5 text-sm font-semibold">{attr.name}{selected[attr.name] ? <span className="font-normal text-muted">: {selected[attr.name]}</span> : null}</legend>
          <div className="flex flex-wrap gap-2">
            {attr.values.map(({ value, colorHex }) => {
              const state = valueState(attr.name, value);
              const on = selected[attr.name] === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  disabled={state === "none"}
                  onClick={() => setSelected((s) => ({ ...s, [attr.name]: value }))}
                  className={cn(
                    "relative flex min-h-11 min-w-12 items-center justify-center gap-2 rounded-full border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-30",
                    on ? "border-brand bg-brand-soft text-brand-ink ring-2 ring-brand/30" : "border-border-strong hover:border-foreground/40",
                    state === "soldout" && "text-muted line-through decoration-1",
                  )}
                >
                  {colorHex && <span className="size-4 rounded-full border border-black/15" style={{ background: colorHex }} />}
                  {value}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className="grid gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">Quantity</span>
          <div className="flex items-center rounded-full border border-border-strong">
            <button type="button" className="grid size-11 place-items-center rounded-full text-muted hover:text-foreground disabled:opacity-30" onClick={() => setQty(Math.max(1, qty - 1))} disabled={qty <= 1} aria-label="Decrease quantity"><Minus className="size-4" /></button>
            <span className="w-8 text-center font-mono text-sm font-semibold tabular-nums" aria-live="polite">{qty}</span>
            <button type="button" className="grid size-11 place-items-center rounded-full text-muted hover:text-foreground disabled:opacity-30" onClick={() => setQty(Math.min(limit || 1, qty + 1))} disabled={!limit || qty >= limit} aria-label="Increase quantity"><Plus className="size-4" /></button>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button size="lg" onClick={() => add(false)} disabled={!variant || limit <= 0 || busy !== null} className="w-full">
            {busy === "add" ? <Loader2 className="animate-spin" /> : added ? <Check /> : <ShoppingBag />}
            {!variant ? "Choose options" : limit <= 0 ? "Sold out" : added ? "Added" : "Add to cart"}
          </Button>
          <Button size="lg" variant="white" onClick={() => add(true)} disabled={!variant || limit <= 0 || busy !== null} className="w-full">
            {busy === "buy" ? <Loader2 className="animate-spin" /> : <Zap />}Buy now
          </Button>
        </div>
      </div>
    </div>
  );
}
