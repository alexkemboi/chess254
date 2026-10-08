"use client";
import * as React from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { cancelMyBookingAction } from "@/actions/booking";

export function CancelBookingDialog({ bookingId, policy }: { bookingId: string; policy?: string | null }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost" size="sm">Cancel</Button></DialogTrigger>
      <DialogContent title="Cancel this booking?" description={policy ?? undefined}>
        <ActionForm action={(fd) => cancelMyBookingAction(bookingId, fd)} onSuccess={() => setOpen(false)} className="grid gap-4">
          <Field name="reason" label="Reason (optional)"><Textarea name="reason" maxLength={300} className="min-h-20" /></Field>
          <SubmitButton variant="danger">Cancel booking</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
