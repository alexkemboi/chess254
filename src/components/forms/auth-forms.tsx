"use client";
import * as React from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "./action-form";
import { Input, Select } from "@/components/ui/input";
import { forgotPasswordAction, loginAction, registerAction, resendVerificationAction, resetPasswordAction } from "@/actions/auth";

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

export function LoginForm({ next }: { next?: string }) {
  return (
    <ActionForm action={loginAction} className="grid gap-5" successMessage={false}>
      <input type="hidden" name="next" value={next ?? ""} />
      <Field name="email" label="Email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <Field name="password" label="Password"><PasswordInput id="password" name="password" autoComplete="current-password" required /></Field>
      <div className="-mt-2 text-right text-sm"><Link href="/forgot-password" className="text-brand-ink hover:underline">Forgot password?</Link></div>
      <SubmitButton size="lg" pendingLabel="Signing in…">Sign in</SubmitButton>
      <p className="text-center text-sm text-muted">New here? <Link href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-brand-ink hover:underline">Create an account</Link></p>
    </ActionForm>
  );
}

export function RegisterForm({ guidelines }: { guidelines: string }) {
  return (
    <ActionForm action={registerAction} className="grid gap-5" successMessage={false}>
      <Field name="name" label="Full name"><Input id="name" name="name" autoComplete="name" required /></Field>
      <Field name="email" label="Email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="phone" label="Phone (M-Pesa)" hint="Optional"><Input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="07…" /></Field>
        <Field name="chessLevel" label="Your level">
          <Select id="chessLevel" name="chessLevel" defaultValue="">
            <option value="">Prefer not to say</option>
            <option>Complete beginner</option>
            <option>Casual player</option>
            <option>Club player</option>
            <option>Tournament player</option>
          </Select>
        </Field>
      </div>
      <Field name="password" label="Password" hint="At least 10 characters with letters and numbers."><PasswordInput id="password" name="password" autoComplete="new-password" required /></Field>
      <Field name="terms">
        <label className="flex items-start gap-3 text-sm text-muted">
          <input type="checkbox" name="terms" required className="mt-1 size-4 accent-[var(--brand)]" />
          <span>I agree to play fair and follow the community guidelines{guidelines ? `: ${guidelines}` : "."}</span>
        </label>
      </Field>
      <SubmitButton size="lg" pendingLabel="Creating account…">Create account</SubmitButton>
      <p className="text-center text-sm text-muted">Already a member? <Link href="/login" className="font-semibold text-brand-ink hover:underline">Sign in</Link></p>
    </ActionForm>
  );
}

export function ResendForm({ email }: { email?: string }) {
  return (
    <ActionForm action={resendVerificationAction} className="grid gap-3">
      <Field name="email" label="Didn't get it? Resend to"><Input name="email" type="email" defaultValue={email} required /></Field>
      <SubmitButton variant="secondary">Resend confirmation</SubmitButton>
    </ActionForm>
  );
}

export function ForgotForm() {
  return (
    <ActionForm action={forgotPasswordAction} className="grid gap-5" resetOnSuccess>
      <Field name="email" label="Email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <SubmitButton size="lg">Send reset link</SubmitButton>
      <p className="text-center text-sm text-muted"><Link href="/login" className="text-brand-ink hover:underline">Back to sign in</Link></p>
    </ActionForm>
  );
}

export function ResetForm({ token }: { token: string }) {
  return (
    <ActionForm action={resetPasswordAction} className="grid gap-5">
      <input type="hidden" name="token" value={token} />
      <Field name="password" label="New password" hint="At least 10 characters with letters and numbers."><PasswordInput id="password" name="password" autoComplete="new-password" required /></Field>
      <Field name="confirm" label="Confirm password"><PasswordInput id="confirm" name="confirm" autoComplete="new-password" required /></Field>
      <SubmitButton size="lg">Update password</SubmitButton>
    </ActionForm>
  );
}
