"use client";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Textarea } from "@/components/ui/input";
import { submitAssignmentAction } from "@/actions/learning";

export function AssignmentSubmitForm({ assignmentId, defaultValue }: { assignmentId: string; defaultValue?: string | null }) {
  return (
    <ActionForm action={(fd) => submitAssignmentAction(assignmentId, fd)} className="mt-4 grid gap-3">
      <Field name="submission" label="Your work" hint="Paste a PGN, link to your game, or write your answers.">
        <Textarea name="submission" defaultValue={defaultValue ?? ""} required className="min-h-28" />
      </Field>
      <div><SubmitButton>{defaultValue ? "Resubmit" : "Submit to coach"}</SubmitButton></div>
    </ActionForm>
  );
}
