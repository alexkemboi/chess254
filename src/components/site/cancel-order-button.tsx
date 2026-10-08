"use client";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { cancelOrderAction } from "@/actions/commerce";

export function CancelOrderButton({ orderId }: { orderId: string }) {
  return (
    <ActionForm action={() => cancelOrderAction(orderId)} confirm="Cancel this order and release anything held for it?" className="mt-4 text-center">
      <SubmitButton variant="ghost" size="sm">Cancel order</SubmitButton>
    </ActionForm>
  );
}
