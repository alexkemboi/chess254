import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const fieldClass =
  "w-full rounded-xl border border-border bg-surface-2/60 px-3.5 text-sm text-foreground placeholder:text-muted-2 transition-colors outline-none focus:border-brand focus:bg-surface-2 aria-[invalid=true]:border-danger disabled:opacity-60";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(fieldClass, "h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(fieldClass, "min-h-28 py-3 leading-relaxed", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select className={cn(fieldClass, "h-11 appearance-none pr-9", props.multiple && "h-auto min-h-28 py-2", className)} {...props}>
        {children}
      </select>
      {!props.multiple && <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />}
    </div>
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("text-sm font-semibold text-foreground", className)} {...props} />;
}
