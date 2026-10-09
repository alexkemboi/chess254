"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Toggle that always posts "true" / "false" so unchecked values reach the server. */
export function Switch({ name, defaultChecked = false, label, description }: { name: string; defaultChecked?: boolean; label?: string; description?: string }) {
  const [on, setOn] = React.useState(defaultChecked);
  return (
    <div className="flex items-start justify-between gap-4">
      {(label || description) && (
        <div>
          {label && <div className="text-[13px] font-medium">{label}</div>}
          {description && <div className="mt-0.5 text-xs text-muted">{description}</div>}
        </div>
      )}
      <input type="hidden" name={name} value={on ? "true" : "false"} />
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label ?? name}
        onClick={() => setOn(!on)}
        className={cn("relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors", on ? "border-brand bg-brand" : "border-border-strong bg-surface-3")}
      >
        <span className={cn("absolute top-0.5 size-[18px] rounded-full transition-all", on ? "left-[22px] bg-black" : "left-0.5 bg-foreground/70")} />
      </button>
    </div>
  );
}
