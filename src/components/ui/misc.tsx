import * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-xl", className)} aria-hidden />;
}

export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border-strong bg-surface/50 px-6 py-14 text-center", className)}>
      <div className="checker pointer-events-none absolute inset-0 opacity-60" />
      <div className="relative mb-4 grid size-14 place-items-center rounded-2xl border border-border bg-surface-2 text-2xl text-brand [&_svg]:size-6">{icon ?? "♞"}</div>
      <h3 className="relative text-lg font-semibold tracking-tight">{title}</h3>
      {description && <p className="relative mt-2 max-w-sm text-sm leading-relaxed text-muted">{description}</p>}
      {action && <div className="relative mt-6">{action}</div>}
    </div>
  );
}

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className={cn("w-full min-w-[640px] text-left text-sm", className)} {...props} />
    </div>
  );
}
export const THead = (p: React.ComponentProps<"thead">) => <thead className="border-b border-border text-[11px] uppercase tracking-wider text-muted" {...p} />;
export const TH = ({ className, ...p }: React.ComponentProps<"th">) => <th className={cn("px-4 py-3 font-semibold", className)} {...p} />;
export const TR = ({ className, ...p }: React.ComponentProps<"tr">) => <tr className={cn("border-b border-border/70 last:border-0 hover:bg-white/[0.02]", className)} {...p} />;
export const TD = ({ className, ...p }: React.ComponentProps<"td">) => <td className={cn("px-4 py-3 align-middle", className)} {...p} />;

export function Stat({ label, value, hint, icon, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-border bg-surface p-5", className)}>
      <div className="flex items-center justify-between text-[13px] text-muted">
        <span>{label}</span>
        {icon && <span className="text-brand [&_svg]:size-4">{icon}</span>}
      </div>
      <div className="mt-3 font-display text-3xl font-extrabold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
