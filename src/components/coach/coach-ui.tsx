"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { addTimeOffAction, cancelAssignmentAction, coachCancelSessionAction, createAssignmentAction, removeTimeOffAction, reviewAssignmentAction, saveAvailabilityAction, updateSessionAction } from "@/actions/coach";
import { WEEKDAYS } from "@/lib/format";
import type { ActionResult } from "@/lib/action";

type Window = { weekday: number; startTime: string; endTime: string };

export function AvailabilityEditor({ initial, hours, save = saveAvailabilityAction }: { initial: Window[]; hours: { weekday: number; opensAt: string; closesAt: string; closed: boolean }[]; save?: (windowsJson: string) => Promise<ActionResult> }) {
  const router = useRouter();
  const [windows, setWindows] = React.useState<Window[]>(initial);
  const [saving, setSaving] = React.useState(false);
  const order = [1, 2, 3, 4, 5, 6, 0];

  function update(i: number, patch: Partial<Window>) {
    setWindows((w) => w.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  return (
    <div className="grid gap-3">
      {order.map((day) => {
        const club = hours.find((h) => h.weekday === day);
        const list = windows.map((w, i) => ({ ...w, i })).filter((w) => w.weekday === day);
        return (
          <div key={day} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold">{WEEKDAYS[day]}</div>
                <div className="text-xs text-muted">{club ? (club.closed ? "Clubhouse closed" : `Clubhouse ${club.opensAt}–${club.closesAt}`) : "No clubhouse hours set"}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setWindows((w) => [...w, { weekday: day, startTime: club && !club.closed ? club.opensAt : "16:00", endTime: club && !club.closed ? club.closesAt : "20:00" }])}><Plus />Add hours</Button>
            </div>
            {list.length > 0 && (
              <div className="mt-3 grid gap-2">
                {list.map((w) => (
                  <div key={w.i} className="flex items-center gap-2">
                    <Input type="time" value={w.startTime} onChange={(e) => update(w.i, { startTime: e.target.value })} className="h-10 max-w-36" aria-label="Start" />
                    <span className="text-muted">–</span>
                    <Input type="time" value={w.endTime} onChange={(e) => update(w.i, { endTime: e.target.value })} className="h-10 max-w-36" aria-label="End" />
                    <Button variant="ghost" size="icon-sm" onClick={() => setWindows((all) => all.filter((_, j) => j !== w.i))} aria-label="Remove"><Trash2 /></Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div>
        <Button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            const res = await save(JSON.stringify(windows));
            setSaving(false);
            if (res.ok) {
              toast.success(res.message);
              router.refresh();
            } else toast.error(res.error);
          }}
        >
          {saving && <Loader2 className="animate-spin" />}Save availability
        </Button>
      </div>
    </div>
  );
}

export function TimeOffForm() {
  return (
    <ActionForm action={addTimeOffAction} resetOnSuccess className="grid gap-4 sm:grid-cols-2">
      <Field name="startDate" label="From date"><Input type="date" name="startDate" required /></Field>
      <Field name="startTime" label="From time"><Input type="time" name="startTime" defaultValue="00:00" /></Field>
      <Field name="endDate" label="To date"><Input type="date" name="endDate" required /></Field>
      <Field name="endTime" label="To time"><Input type="time" name="endTime" defaultValue="23:59" /></Field>
      <Field name="reason" label="Reason (private)" className="sm:col-span-2"><Input name="reason" maxLength={200} /></Field>
      <div className="sm:col-span-2"><SubmitButton>Block this time</SubmitButton></div>
    </ActionForm>
  );
}

export function RemoveTimeOff({ id }: { id: string }) {
  return (
    <ActionForm action={() => removeTimeOffAction(id)}>
      <SubmitButton variant="ghost" size="icon-sm"><Trash2 /></SubmitButton>
    </ActionForm>
  );
}

export function SessionControls({ bookingId, status, notes, started }: { bookingId: string; status: string; notes: string | null; started: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild><Button size="sm" variant="secondary">{started ? "Record outcome" : "Notes"}</Button></DialogTrigger>
        <DialogContent title="Session notes" description="Notes are shared with the member once the session is marked complete.">
          <ActionForm action={(fd) => updateSessionAction(bookingId, fd)} onSuccess={() => setOpen(false)} className="grid gap-4">
            <Field name="status" label="Status">
              <Select name="status" defaultValue={status}>
                <option value="CONFIRMED">Confirmed</option>
                {started && <option value="COMPLETED">Completed</option>}
                {started && <option value="NO_SHOW">No-show</option>}
              </Select>
            </Field>
            <Field name="coachNotes" label="Notes"><Textarea name="coachNotes" defaultValue={notes ?? ""} className="min-h-32" placeholder="What you worked on, homework, observations…" /></Field>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>
      {status === "CONFIRMED" && !started && (
        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogTrigger asChild><Button size="sm" variant="ghost">Cancel</Button></DialogTrigger>
          <DialogContent title="Cancel session" description="The member is notified immediately.">
            <ActionForm action={(fd) => coachCancelSessionAction(bookingId, fd)} onSuccess={() => setCancelOpen(false)} className="grid gap-4">
              <Field name="reason" label="Reason"><Textarea name="reason" required /></Field>
              <SubmitButton variant="danger">Cancel session</SubmitButton>
            </ActionForm>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export function NewAssignmentForm({ members, materials, defaultMember }: { members: { id: string; name: string }[]; materials: { id: string; title: string }[]; defaultMember?: string }) {
  return (
    <ActionForm action={createAssignmentAction} resetOnSuccess className="grid gap-4">
      <Field name="memberId" label="Member">
        <Select name="memberId" defaultValue={defaultMember ?? ""} required>
          <option value="" disabled>Select a member…</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
      </Field>
      <Field name="title" label="Title"><Input name="title" required maxLength={160} /></Field>
      <Field name="instructions" label="Instructions"><Textarea name="instructions" maxLength={5000} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="materialId" label="Linked lesson (optional)">
          <Select name="materialId" defaultValue="">
            <option value="">None</option>
            {materials.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
          </Select>
        </Field>
        <Field name="dueDate" label="Due date"><Input type="date" name="dueDate" /></Field>
      </div>
      <div><SubmitButton>Send assignment</SubmitButton></div>
    </ActionForm>
  );
}

export function ReviewForm({ assignmentId, feedback }: { assignmentId: string; feedback: string | null }) {
  return (
    <ActionForm action={(fd) => reviewAssignmentAction(assignmentId, fd)} className="mt-3 grid gap-3">
      <Field name="feedback"><Textarea name="feedback" defaultValue={feedback ?? ""} placeholder="Your feedback…" required /></Field>
      <div className="flex gap-2"><SubmitButton size="sm">Send feedback</SubmitButton></div>
    </ActionForm>
  );
}

export function WithdrawAssignment({ id }: { id: string }) {
  return (
    <ActionForm action={() => cancelAssignmentAction(id)} confirm="Withdraw this assignment?">
      <SubmitButton size="sm" variant="ghost">Withdraw</SubmitButton>
    </ActionForm>
  );
}
