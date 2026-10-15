"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { Img as Image } from "@/components/ui/img";
import { removeCartItemAction, updateCartItemAction } from "@/actions/shop";
import { ProductArt } from "./product-card";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export type CartLineView = { id: string; slug: string; name: string; variantName: string | null; image: string | null; unitPrice: number; regularPrice: number; quantity: number; lineTotal: number; maxQuantity: number; issue: null | "unavailable" | "insufficient" };

export function CartLines({ lines, currency }: { lines: CartLineView[]; currency: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  async function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(id);
    const res = await fn();
    setBusy(null);
    if (!res.ok) toast.error(res.error ?? "Couldn't update your cart");
    startTransition(() => router.refresh());
  }

  return (
    <ul className="divide-y divide-border rounded-3xl border border-border bg-surface">
      {lines.map((l) => (
        <li key={l.id} className={cn("flex gap-4 p-4 sm:p-5", busy === l.id && "opacity-60")}>
          <Link href={`/shop/${l.slug}`} className="relative size-24 shrink-0 overflow-hidden rounded-2xl border border-border bg-white sm:size-28">
            {l.image ? <Image src={l.image} alt={l.name} fill sizes="112px" className="object-cover" /> : <ProductArt />}
          </Link>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/shop/${l.slug}`} className="line-clamp-2 font-semibold leading-snug hover:text-brand-ink">{l.name}</Link>
                {l.variantName && <div className="mt-0.5 text-sm text-muted">{l.variantName}</div>}
                <div className="mt-1 text-sm">
                  <span className="font-mono">{formatMoney(l.unitPrice, currency)}</span>
                  {l.unitPrice < l.regularPrice && <span className="ml-2 text-xs text-muted line-through">{formatMoney(l.regularPrice, currency)}</span>}
                </div>
              </div>
              <div className="shrink-0 text-right font-mono font-semibold">{l.issue === "unavailable" ? "—" : formatMoney(l.lineTotal, currency)}</div>
            </div>
            {l.issue && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-danger">
                <AlertTriangle className="size-3.5" />
                {l.issue === "unavailable" ? "No longer available — please remove it." : `Only ${l.maxQuantity} available — please reduce the quantity.`}
              </p>
            )}
            <div className="mt-auto flex items-center justify-between gap-3 pt-3">
              {l.issue === "unavailable" ? <span /> : (
                <div className="flex items-center rounded-full border border-border-strong">
                  <button type="button" className="grid size-10 place-items-center text-muted hover:text-foreground disabled:opacity-30" disabled={busy !== null} onClick={() => run(l.id, () => updateCartItemAction(l.id, l.quantity - 1))} aria-label={`Decrease ${l.name}`}><Minus className="size-4" /></button>
                  <span className="w-8 text-center font-mono text-sm font-semibold tabular-nums">{busy === l.id ? <Loader2 className="mx-auto size-4 animate-spin" /> : l.quantity}</span>
                  <button type="button" className="grid size-10 place-items-center text-muted hover:text-foreground disabled:opacity-30" disabled={busy !== null || l.quantity >= l.maxQuantity} onClick={() => run(l.id, () => updateCartItemAction(l.id, l.quantity + 1))} aria-label={`Increase ${l.name}`}><Plus className="size-4" /></button>
                </div>
              )}
              <button type="button" className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-muted hover:bg-danger/10 hover:text-danger" disabled={busy !== null} onClick={() => run(l.id, () => removeCartItemAction(l.id))}>
                <Trash2 className="size-4" />Remove
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
