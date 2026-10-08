"use client";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Input, Textarea } from "@/components/ui/input";
import { contactAction } from "@/actions/contact";

export function ContactForm() {
  return (
    <ActionForm action={contactAction} resetOnSuccess className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="name" label="Name"><Input name="name" autoComplete="name" required /></Field>
        <Field name="email" label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="phone" label="Phone" hint="Optional"><Input name="phone" type="tel" autoComplete="tel" /></Field>
        <Field name="subject" label="Subject"><Input name="subject" required /></Field>
      </div>
      <Field name="message" label="Message"><Textarea name="message" required className="min-h-36" /></Field>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <SubmitButton size="lg" pendingLabel="Sending…">Send message</SubmitButton>
    </ActionForm>
  );
}
