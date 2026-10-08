"use client";
import * as React from "react";
import type { ActionResult } from "@/lib/action";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

type Variant = React.ComponentProps<typeof Button>["variant"];

/** One-click action (optionally confirmed). */
export function ActionButton({ action, children, confirm, variant = "secondary", size = "sm" }: { action: () => Promise<ActionResult<unknown>>; children: React.ReactNode; confirm?: string; variant?: Variant; size?: React.ComponentProps<typeof Button>["size"] }) {
  return (
    <ActionForm action={() => action()} confirm={confirm} className="inline-block">
      <SubmitButton variant={variant} size={size}>{children}</SubmitButton>
    </ActionForm>
  );
}

/** Button that opens a dialog containing a form bound to a Server Action. */
export function FormDialog({ trigger, title, description, action, submitLabel, children, variant = "secondary", submitVariant }: { trigger: React.ReactNode; title: string; description?: string; action: (fd: FormData) => Promise<ActionResult<unknown>>; submitLabel: string; children: React.ReactNode; variant?: Variant; submitVariant?: Variant }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant={variant} size="sm">{trigger}</Button></DialogTrigger>
      <DialogContent title={title} description={description}>
        <ActionForm action={action} onSuccess={() => setOpen(false)} className="grid gap-4">
          {children}
          <SubmitButton variant={submitVariant}>{submitLabel}</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
