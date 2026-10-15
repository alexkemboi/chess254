"use client";
import * as React from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "./action-form";
import { Input, Select } from "@/components/ui/input";
import { claimPaymentAction, completeRegistrationAction, guestCheckoutAction, resendSetupLinkAction } from "@/actions/guest";

function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input type={show ? "text" : "password"} {...props} className="pr-11" />
      <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground" aria-label={show ? "Hide password" : "Show password"}>
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/** Join without an account: details first, then M-Pesa. The account is created after payment. */
export function GuestCheckoutForm({ planId, guidelines }: { planId: string; guidelines: string }) {
  return (
    <ActionForm action={guestCheckoutAction.bind(null, planId)} className="grid gap-4" successMessage={false}>
      <Field name="name" label="Full name"><Input name="name" autoComplete="name" required /></Field>
      <Field name="email" label="Email" hint="Your registration link is sent here after payment."><Input name="email" type="email" autoComplete="email" required /></Field>
      <Field name="phone" label="M-Pesa number"><Input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" required /></Field>
      <Field name="terms">
        <label className="flex items-start gap-3 text-sm text-muted">
          <input type="checkbox" name="terms" required className="mt-1 size-4 accent-[var(--brand)]" />
          <span>I agree to play fair and follow the club rules{guidelines ? `: ${guidelines}` : "."}</span>
        </label>
      </Field>
      <SubmitButton size="lg" pendingLabel="Preparing payment…">Continue to M-Pesa payment</SubmitButton>
      <p className="text-center text-sm text-muted">Already a member? <Link href="/login" className="font-semibold text-brand-ink hover:underline">Sign in</Link></p>
    </ActionForm>
  );
}

export function ClaimForm({ plans }: { plans: { id: string; label: string }[] }) {
  return (
    <ActionForm action={claimPaymentAction} className="grid gap-4" successMessage={false}>
      <Field name="code" label="M-Pesa code" hint="From your M-Pesa SMS, e.g. TJK3AB12CD"><Input name="code" required maxLength={10} autoComplete="off" spellCheck={false} className="font-mono uppercase tracking-widest" /></Field>
      <Field name="planId" label="Membership you paid for">
        <Select name="planId" required defaultValue="">
          <option value="" disabled>Choose a plan</option>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </Select>
      </Field>
      <Field name="phone" label="Phone number you paid with"><Input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" required /></Field>
      <Field name="name" label="Full name"><Input name="name" autoComplete="name" required /></Field>
      <Field name="email" label="Email" hint="We send your registration link here."><Input name="email" type="email" autoComplete="email" required /></Field>
      <SubmitButton size="lg" pendingLabel="Checking with M-Pesa…">Verify payment</SubmitButton>
    </ActionForm>
  );
}

export function CompleteRegistrationForm({ token }: { token: string }) {
  return (
    <ActionForm action={completeRegistrationAction} className="grid gap-5">
      <input type="hidden" name="token" value={token} />
      <Field name="password" label="Choose a password" hint="At least 10 characters with letters and numbers."><PasswordInput name="password" autoComplete="new-password" required /></Field>
      <Field name="confirm" label="Confirm password"><PasswordInput name="confirm" autoComplete="new-password" required /></Field>
      <SubmitButton size="lg" pendingLabel="Creating your account…">Create my account</SubmitButton>
    </ActionForm>
  );
}

export function ResendSetupForm({ email }: { email?: string }) {
  return (
    <ActionForm action={resendSetupLinkAction} className="grid gap-3" resetOnSuccess>
      <Field name="email" label="Email used at payment"><Input name="email" type="email" defaultValue={email} required /></Field>
      <SubmitButton variant="secondary">Send a new registration link</SubmitButton>
    </ActionForm>
  );
}
