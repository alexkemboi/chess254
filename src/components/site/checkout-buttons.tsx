"use client";
import { ArrowRight } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { checkoutPlanAction, checkoutServiceAction } from "@/actions/commerce";

export function CheckoutPlanButton({ planId, label }: { planId: string; label: string }) {
  return (
    <ActionForm action={() => checkoutPlanAction(planId)} successMessage={false}>
      <SubmitButton size="lg" className="w-full" pendingLabel="Preparing your order…">{label}<ArrowRight /></SubmitButton>
    </ActionForm>
  );
}

export function CheckoutServiceButton({ serviceId, label, size }: { serviceId: string; label: string; size?: "default" | "lg" }) {
  return (
    <ActionForm action={() => checkoutServiceAction(serviceId)} successMessage={false}>
      <SubmitButton variant="secondary" size={size} className="w-full">{label}</SubmitButton>
    </ActionForm>
  );
}
