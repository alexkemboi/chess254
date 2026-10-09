"use client";
import * as React from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, children, title, description, ...props }: React.ComponentProps<typeof D.Content> & { title: string; description?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm light:bg-black/35" />
      <D.Content
        className={cn("fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl", className)}
        {...props}
      >
        <div className="mb-5 pr-8">
          <D.Title className="text-lg font-semibold tracking-tight">{title}</D.Title>
          <D.Description className={description ? "mt-1 text-sm text-muted" : "sr-only"}>{description ?? title}</D.Description>
        </div>
        {children}
        <D.Close className="absolute right-4 top-4 rounded-full p-1.5 text-muted hover:bg-foreground/5 hover:text-foreground" aria-label="Close">
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

export function SheetContent({ className, children, title, side = "right", ...props }: React.ComponentProps<typeof D.Content> & { title: string; side?: "right" | "left" }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm light:bg-black/35" />
      <D.Content
        className={cn("fixed inset-y-0 z-50 flex w-[88%] max-w-sm flex-col overflow-y-auto border-border bg-surface p-6 shadow-2xl", side === "right" ? "right-0 border-l" : "left-0 border-r", className)}
        {...props}
      >
        <D.Title className="sr-only">{title}</D.Title>
        <D.Description className="sr-only">{title}</D.Description>
        {children}
        <D.Close className="absolute right-4 top-4 rounded-full p-2 text-muted hover:bg-foreground/5 hover:text-foreground" aria-label="Close">
          <X className="size-5" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
