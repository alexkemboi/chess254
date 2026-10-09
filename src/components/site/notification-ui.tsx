"use client";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/actions/account";

export function MarkAllReadButton() {
  return (
    <ActionForm action={() => markAllNotificationsReadAction()}>
      <SubmitButton variant="secondary" size="sm"><CheckCheck />Mark all read</SubmitButton>
    </ActionForm>
  );
}

export function NotificationLink({ id, href, unread, children }: { id: string; href: string | null; unread: boolean; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="flex w-full items-start gap-4 p-5 text-left hover:bg-foreground/[0.03]"
      onClick={async () => {
        if (unread) await markNotificationReadAction(id);
        if (href) router.push(href);
        else router.refresh();
      }}
    >
      {children}
    </button>
  );
}
