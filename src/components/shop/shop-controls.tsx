"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";

/** Sort dropdown and in-stock toggle that update the query string. */
export function ShopControls({ sorts, sort, inStock }: { sorts: Record<string, string>; sort: string; inStock: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    router.push(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  return (
    <div className="flex items-center gap-2">
      <label className="flex h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm">
        <input type="checkbox" checked={inStock} onChange={(e) => set("stock", e.target.checked ? "1" : null)} className="size-4 accent-[var(--brand)]" />
        In stock
      </label>
      <div className="relative">
        <select aria-label="Sort products" value={sort} onChange={(e) => set("sort", e.target.value === "featured" ? null : e.target.value)} className="h-11 appearance-none rounded-full border border-border bg-surface pl-4 pr-9 text-sm">
          {Object.entries(sorts).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      </div>
    </div>
  );
}
