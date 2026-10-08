import Link from "next/link";
import { cn } from "@/lib/utils";

/** Wordmark built from brand settings (logoText + logoAccent). */
export function Logo({ text, accent, fallback, className }: { text: string; accent: string; fallback: string; className?: string }) {
  const hasParts = Boolean(text || accent);
  return (
    <Link href="/" className={cn("group flex items-center gap-2.5", className)} aria-label={`${fallback} home`}>
      <span className="relative grid size-9 place-items-center rounded-xl bg-brand font-display text-xl font-black text-black transition-transform duration-300 group-hover:rotate-[-8deg]">
        #
      </span>
      <span className="font-display text-xl font-extrabold tracking-tight">
        {hasParts ? (
          <>
            {text}
            <span className="text-brand">{accent}</span>
          </>
        ) : (
          fallback
        )}
      </span>
    </Link>
  );
}
