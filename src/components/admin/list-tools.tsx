"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Search box that keeps other filters in the query string. */
export function SearchBox({ placeholder, defaultValue, name = "q" }: { placeholder: string; defaultValue?: string; name?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <form
      role="search"
      className="relative max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const value = String(new FormData(e.currentTarget).get(name) ?? "").trim();
        const next = new URLSearchParams(params.toString());
        if (value) next.set(name, value);
        else next.delete(name);
        next.delete("page");
        router.push(`${pathname}${next.size ? `?${next}` : ""}`);
      }}
    >
      <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input name={name} defaultValue={defaultValue} placeholder={placeholder} className="h-10 w-full rounded-full border border-border bg-surface pl-10 pr-4 text-sm outline-none focus:border-brand" />
    </form>
  );
}

/** Select filter that updates one query param. */
export function FilterSelect({ name, value, options, label }: { name: string; value?: string; options: { value: string; label: string }[]; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <select
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        if (e.target.value) next.set(name, e.target.value);
        else next.delete(name);
        next.delete("page");
        router.push(`${pathname}${next.size ? `?${next}` : ""}`);
      }}
      className="h-10 rounded-full border border-border bg-surface px-4 text-sm"
    >
      <option value="">{label}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function DateFilter({ name, value, label }: { name: string; value?: string; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      {label}
      <input
        type="date"
        value={value ?? ""}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set(name, e.target.value);
          else next.delete(name);
          next.delete("page");
          router.push(`${pathname}${next.size ? `?${next}` : ""}`);
        }}
        className="h-10 rounded-full border border-border bg-surface px-3 text-sm text-foreground"
      />
    </label>
  );
}

export function Pagination({ page, total, pageSize }: { page: number; total: number; pageSize: number }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="mt-3 text-xs text-muted">{total} total</p>;
  const href = (p: number) => {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(p));
    return `${pathname}?${next}`;
  };
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted">
      <span>{total} total · page {page} of {pages}</span>
      <div className="flex gap-2">
        {page > 1 && <Button asChild size="sm" variant="secondary"><Link href={href(page - 1)}>Previous</Link></Button>}
        {page < pages && <Button asChild size="sm" variant="secondary"><Link href={href(page + 1)}>Next</Link></Button>}
      </div>
    </div>
  );
}
