"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Section navigation: horizontal scroller on mobile, vertical list on desktop. */
export function SubNav({ items, root }: { items: { href: string; label: string; badge?: number }[]; root: string }) {
  const pathname = usePathname();
  return (
    <nav className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0" aria-label="Section">
      {items.map((item) => {
        const active = item.href === root ? pathname === root : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn("flex items-center justify-between gap-3 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition", active ? "bg-brand-soft text-brand" : "text-muted hover:bg-white/5 hover:text-foreground")}
          >
            {item.label}
            {item.badge ? <span className="rounded-full bg-brand px-1.5 text-[10px] font-bold text-black">{item.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
