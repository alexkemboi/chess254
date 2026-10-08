"use client";
import { AvailabilityEditor } from "@/components/coach/coach-ui";
import { adminSaveCoachAvailabilityAction } from "@/actions/admin";

type Window = { weekday: number; startTime: string; endTime: string };

export function AdminAvailabilityEditor({ coachId, initial, hours }: { coachId: string; initial: Window[]; hours: { weekday: number; opensAt: string; closesAt: string; closed: boolean }[] }) {
  return <AvailabilityEditor initial={initial} hours={hours} save={(json) => adminSaveCoachAvailabilityAction(coachId, json)} />;
}
