"use client";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Input, Textarea } from "@/components/ui/input";
import { updateProfileAction } from "@/actions/account";
import { changePasswordAction } from "@/actions/auth";

type Defaults = { name: string; phone: string; bio: string; chessLevel: string; rating: string; lichessUsername: string; chesscomUsername: string };

export function ProfileForm({ defaults }: { defaults: Defaults }) {
  return (
    <ActionForm action={updateProfileAction} className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="name" label="Full name"><Input name="name" defaultValue={defaults.name} required /></Field>
        <Field name="phone" label="M-Pesa phone"><Input name="phone" type="tel" defaultValue={defaults.phone} /></Field>
        <Field name="chessLevel" label="Level"><Input name="chessLevel" defaultValue={defaults.chessLevel} placeholder="e.g. Club player" /></Field>
        <Field name="rating" label="Rating (FIDE / online)"><Input name="rating" type="number" min={100} max={3500} defaultValue={defaults.rating} /></Field>
        <Field name="lichessUsername" label="Lichess username"><Input name="lichessUsername" defaultValue={defaults.lichessUsername} /></Field>
        <Field name="chesscomUsername" label="Chess.com username"><Input name="chesscomUsername" defaultValue={defaults.chesscomUsername} /></Field>
      </div>
      <Field name="bio" label="About you" hint="Shared with your coaches."><Textarea name="bio" defaultValue={defaults.bio} maxLength={1000} /></Field>
      <div><SubmitButton>Save profile</SubmitButton></div>
    </ActionForm>
  );
}

export function PasswordForm() {
  return (
    <ActionForm action={changePasswordAction} resetOnSuccess className="grid max-w-md gap-5">
      <Field name="current" label="Current password"><Input name="current" type="password" autoComplete="current-password" required /></Field>
      <Field name="password" label="New password" hint="At least 10 characters with letters and numbers."><Input name="password" type="password" autoComplete="new-password" required /></Field>
      <Field name="confirm" label="Confirm new password"><Input name="confirm" type="password" autoComplete="new-password" required /></Field>
      <div><SubmitButton>Update password</SubmitButton></div>
    </ActionForm>
  );
}
