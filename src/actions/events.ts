"use server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertUser } from "@/server/auth";
import { runAction, UserError, type ActionResult } from "@/server/errors";
import { cancelRegistration, registerForEvent } from "@/server/events";
import { alertAdmins, emailNotifications } from "@/server/notifications";
import { rateLimit } from "@/server/rate-limit";

const id = z.string().min(1).max(40);

export async function registerEventAction(eventId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    if (!(await rateLimit(`event:${user.id}`, 15, 3600))) throw new UserError("Too many attempts. Please try again later.");
    const { registration, orderId } = await registerForEvent(user.id, id.parse(eventId));
    if (orderId) return { ok: true, message: "Seat held — complete payment to confirm.", redirect: `/pay/${orderId}` };
    const n = await prisma.notification.findFirst({ where: { userId: user.id, type: "EVENT_REGISTERED" }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (n) await emailNotifications([n.id]);
    return { ok: true, message: `You're registered! Reference ${registration.reference}` };
  });
}

export async function cancelEventRegistrationAction(registrationId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const { registration, paid } = await cancelRegistration(id.parse(registrationId), { id: user.id, asStaff: false });
    if (paid) await alertAdmins("Paid event registration cancelled", `${registration.event.title}: registration ${registration.reference} cancelled after payment. Review refund.`, "/admin/events");
    return { ok: true, message: "Registration cancelled." };
  });
}
