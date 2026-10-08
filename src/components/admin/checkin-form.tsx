"use client";
import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Input } from "@/components/ui/input";
import { frontDeskAction } from "@/actions/admin";

export function CheckInForm() {
  const [last, setLast] = React.useState<{ kind: string; detail: string } | null>(null);
  return (
    <div className="grid gap-4">
      <ActionForm action={frontDeskAction} resetOnSuccess onSuccess={(r) => setLast((r.data as { kind: string; detail: string }) ?? null)} className="flex items-end gap-2">
        <Field name="code" label="Pass code or reference" className="flex-1"><Input name="code" autoFocus autoComplete="off" placeholder="PS-XXXXXX / EV-XXXXXX / BK-XXXXXX" className="h-12 font-mono uppercase" required /></Field>
        <SubmitButton size="lg">Check in</SubmitButton>
      </ActionForm>
      {last && <div className="flex items-center gap-3 rounded-xl bg-success/10 p-4 text-sm text-success"><CheckCircle2 className="size-5" /><span><b>{last.detail}</b> · {last.kind}</span></div>}
    </div>
  );
}
