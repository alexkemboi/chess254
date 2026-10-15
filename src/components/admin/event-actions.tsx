"use client";
import { Archive, ArchiveRestore, Ban, Copy, Eye, EyeOff } from "lucide-react";
import { ActionButton } from "@/components/admin/admin-ui";
import { cancelEventAction, duplicateEventAction, setEventArchivedAction, setEventPublishedAction } from "@/actions/admin-events";

/** Lifecycle buttons on the event editor. Server actions re-check every permission. */
export function EventActions({ eventId, status, archived, canPublish }: { eventId: string; status: string; archived: boolean; canPublish: boolean }) {
  return (
    <>
      {canPublish && !archived && (status === "PUBLISHED" ? (
        <ActionButton action={() => setEventPublishedAction(eventId, false)} confirm="Unpublish this event? Its page and registration form go offline."><EyeOff />Unpublish</ActionButton>
      ) : status !== "CANCELLED" ? (
        <ActionButton action={() => setEventPublishedAction(eventId, true)} variant="default"><Eye />Publish</ActionButton>
      ) : null)}
      <ActionButton action={() => duplicateEventAction(eventId)}><Copy />Duplicate</ActionButton>
      {canPublish && status !== "CANCELLED" && <ActionButton action={() => cancelEventAction(eventId)} confirm="Cancel this event? Registration closes and every registrant is notified."><Ban />Cancel event</ActionButton>}
      {canPublish && (archived ? (
        <ActionButton action={() => setEventArchivedAction(eventId, false)}><ArchiveRestore />Restore</ActionButton>
      ) : (
        <ActionButton action={() => setEventArchivedAction(eventId, true)} confirm="Archive this event? It disappears from the website; registrations and payments are kept."><Archive />Archive</ActionButton>
      ))}
    </>
  );
}
