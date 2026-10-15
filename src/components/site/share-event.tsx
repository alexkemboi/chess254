"use client";
import * as React from "react";
import { toast } from "sonner";
import { Check, Copy, Mail, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Share / invite links for an event's public page. Uses the phone's share
 * sheet when available; otherwise offers WhatsApp, Facebook, X, email and copy.
 * Only ever shares the public URL — never a private booking link.
 */
export function ShareEvent({ url, title, text, variant = "full", className }: { url: string; title: string; text: string; variant?: "full" | "compact" | "dark"; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  const canShare = React.useSyncExternalStore(noopSubscribe, () => typeof navigator.share === "function", () => false);
  const message = `${text} ${url}`;
  const enc = encodeURIComponent;

  async function nativeShare() {
    try {
      await navigator.share({ title, text, url });
    } catch {
      /* dismissed */
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied — paste it anywhere to invite others.");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Couldn't copy. Long-press the link to copy it instead.");
    }
  }

  const pill = variant === "dark" ? "border-white/20 bg-white/[0.06] text-white hover:border-brand" : "border-border bg-surface hover:border-brand";
  const links = [
    { label: "WhatsApp", href: `https://wa.me/?text=${enc(message)}`, icon: <WhatsAppIcon />, accent: "text-[#25D366]" },
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`, icon: <span className="text-base font-black leading-none">f</span>, accent: "text-[#1877F2]" },
    { label: "X", href: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`, icon: <span className="text-sm font-black leading-none">𝕏</span>, accent: "" },
    { label: "Email", href: `mailto:?subject=${enc(title)}&body=${enc(message)}`, icon: <Mail className="size-4" />, accent: "" },
  ];

  if (variant === "compact" || variant === "dark") {
    return (
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        {canShare && (
          <button type="button" onClick={nativeShare} className={cn("inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition", pill)}><Share2 className="size-4" />Share</button>
        )}
        <a href={links[0].href} target="_blank" rel="noopener noreferrer" className={cn("inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition", pill)}><span className={links[0].accent}>{links[0].icon}</span>WhatsApp</a>
        <button type="button" onClick={copy} className={cn("inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition", pill)}>{copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}{copied ? "Copied" : "Copy invite link"}</button>
      </div>
    );
  }

  return (
    <div className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3", className)}>
      {canShare && (
        <button type="button" onClick={nativeShare} className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand px-5 text-base font-bold text-brand-foreground transition hover:brightness-110"><Share2 className="size-5" />Share invite</button>
      )}
      <div className="grid grid-cols-4 gap-2">
        {links.map((l) => (
          <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-surface text-xs font-semibold transition hover:border-brand" aria-label={`Share on ${l.label}`}>
            <span className={cn("grid size-6 place-items-center", l.accent)}>{l.icon}</span>{l.label}
          </a>
        ))}
      </div>
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface-2/60 p-1.5 pl-4">
        <span className="min-w-0 flex-1 truncate text-sm text-muted" title={url}>{url.replace(/^https?:\/\//, "")}</span>
        <button type="button" onClick={copy} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition hover:bg-foreground/85">{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}

const noopSubscribe = () => () => {};

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35zM12.05 21.8h-.01a9.8 9.8 0 0 1-5-1.37l-.36-.21-3.72.98 1-3.63-.24-.37a9.82 9.82 0 0 1-1.5-5.22c0-5.42 4.42-9.84 9.85-9.84 2.63 0 5.1 1.03 6.96 2.89a9.78 9.78 0 0 1 2.88 6.96c0 5.43-4.42 9.84-9.86 9.84zm8.39-18.23A11.78 11.78 0 0 0 12.05.1C5.5.1.17 5.43.17 11.99c0 2.1.55 4.14 1.59 5.94L.07 24.1l6.3-1.65a11.86 11.86 0 0 0 5.67 1.44h.01c6.55 0 11.88-5.33 11.89-11.89 0-3.18-1.24-6.16-3.5-8.43z" />
    </svg>
  );
}
