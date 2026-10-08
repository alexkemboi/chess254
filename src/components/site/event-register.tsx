"use client";
import { Ticket } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { cancelEventRegistrationAction, registerEventAction } from "@/actions/events";

export function RegisterEventButton({ eventId, label }: { eventId: string; label: string }) {
  return (
    <ActionForm action={() => registerEventAction(eventId)}>
      <SubmitButton size="lg" className="w-full" pendingLabel="Reserving your seat…"><Ticket />{label}</SubmitButton>
    </ActionForm>
  );
}

export function CancelRegistrationButton({ registrationId }: { registrationId: string }) {
  return (
    <ActionForm action={() => cancelEventRegistrationAction(registrationId)} confirm="Cancel your registration?">
      <SubmitButton variant="ghost" size="sm">Cancel registration</SubmitButton>
    </ActionForm>
  );
}
