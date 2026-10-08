"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { ActionResult } from "@/lib/action";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const FieldErrors = React.createContext<Record<string, string>>({});

type Props = Omit<React.ComponentProps<"form">, "action" | "onSubmit"> & {
  action: (formData: FormData) => Promise<ActionResult<unknown>>;
  successMessage?: string | false;
  resetOnSuccess?: boolean;
  onSuccess?: (result: Extract<ActionResult<unknown>, { ok: true }>) => void;
  confirm?: string;
};

export function ActionForm({ action, successMessage, resetOnSuccess, onSuccess, confirm, children, className, ...rest }: Props) {
  const router = useRouter();
  const ref = React.useRef<HTMLFormElement>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [, startTransition] = React.useTransition();

  async function submit(formData: FormData) {
    if (confirm && !window.confirm(confirm)) return;
    let result: ActionResult<unknown>;
    try {
      result = await action(formData);
    } catch {
      toast.error("Network error. Please check your connection and try again.");
      return;
    }
    if (!result) return;
    if (result.ok) {
      setErrors({});
      if (successMessage !== false) toast.success(result.message ?? successMessage ?? "Saved");
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(result);
      if (result.redirect) router.push(result.redirect);
      else startTransition(() => router.refresh());
    } else {
      setErrors(result.fieldErrors ?? {});
      toast.error(result.error);
    }
  }

  return (
    <FieldErrors.Provider value={errors}>
      <form ref={ref} action={submit} className={className} noValidate={false} {...rest}>
        {children}
      </form>
    </FieldErrors.Provider>
  );
}

export function Field({ name, label, hint, children, className }: { name: string; label?: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  const errors = React.useContext(FieldErrors);
  const error = errors[name];
  return (
    <div className={cn("grid gap-1.5", className)}>
      {label && <Label htmlFor={name}>{label}</Label>}
      <div aria-invalid={Boolean(error)}>{children}</div>
      {error ? <p className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function SubmitButton({ children, className, variant, size, pendingLabel }: { children: React.ReactNode; className?: string; variant?: React.ComponentProps<typeof Button>["variant"]; size?: React.ComponentProps<typeof Button>["size"]; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className={className} variant={variant} size={size}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
