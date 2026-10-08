"use client";
import * as React from "react";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { broadcastAction } from "@/actions/admin";

export function BroadcastForm({ plans }: { plans: { value: string; label: string }[] }) {
  const [audience, setAudience] = React.useState("ALL");
  return (
    <ActionForm action={broadcastAction} resetOnSuccess confirm="Send this notification now?" className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="audience" label="Audience">
          <Select name="audience" value={audience} onChange={(e) => setAudience(e.target.value)}>
            <option value="ALL">Everyone with an account</option>
            <option value="ACTIVE_MEMBERS">Active members</option>
            <option value="NO_MEMBERSHIP">Members without a plan</option>
            <option value="PLAN">Members on a plan</option>
            <option value="ROLE">A role</option>
          </Select>
        </Field>
        {audience === "PLAN" && <Field name="planId" label="Plan"><Select name="planId">{plans.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>}
        {audience === "ROLE" && <Field name="role" label="Role"><Select name="role">{["MEMBER", "COACH", "MODERATOR", "ADMIN", "SUPER_ADMIN"].map((r) => <option key={r} value={r}>{r.toLowerCase().replace("_", " ")}</option>)}</Select></Field>}
      </div>
      <Field name="title" label="Title"><Input name="title" required maxLength={120} /></Field>
      <Field name="body" label="Message"><Textarea name="body" required maxLength={2000} /></Field>
      <Field name="link" label="Link (optional)" hint="A site path, e.g. /events"><Input name="link" placeholder="/events" /></Field>
      <Switch name="email" label="Also send by email" description="Uses the configured SMTP provider." />
      <div><SubmitButton>Send</SubmitButton></div>
    </ActionForm>
  );
}
