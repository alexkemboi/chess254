"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { assertPermission } from "@/server/auth";
import { audit } from "@/server/audit";
import { runAction, parseForm, UserError, type ActionResult } from "@/server/errors";
import { duplicateEvent, formEventProblems } from "@/server/admin/event-admin";
import { recordItemPayments, registrationPath, sendRegistrationEmail } from "@/server/event-registrations";
import { alertAdmins, emailNotifications, notify } from "@/server/notifications";
import { parseFormFields } from "@/lib/event-form";

const id = z.string().min(1).max(40);

export async function setEventPublishedAction(eventId: string, publish: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("events.publish");
    const event = await prisma.event.findFirst({ where: { id: id.parse(eventId), deletedAt: null }, include: { sessions: true, packages: true } });
    if (!event) throw new UserError("Event not found.");
    if (publish) {
      const problems = formEventProblems({ registrationMode: event.registrationMode, formFields: parseFormFields(event.formFields), sessions: event.sessions, packages: event.packages });
      if (problems.length) throw new UserError(`Can't publish yet: ${problems.join("; ")}.`);
    }
    await prisma.event.update({ where: { id: event.id }, data: publish ? { status: "PUBLISHED", archivedAt: null } : { status: "DRAFT", featured: false } });
    await audit({ actorId: actor.id, action: publish ? "events.publish" : "events.unpublish", entity: "events", entityId: event.id, previous: { status: event.status } });
    revalidatePath("/", "layout");
    return { ok: true, message: publish ? `Published — live at /events/${event.slug}` : "Unpublished — the page is hidden." };
  });
}

export async function duplicateEventAction(eventId: string): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("events.manage");
    const copy = await duplicateEvent(id.parse(eventId));
    await audit({ actorId: actor.id, action: "events.duplicate", entity: "events", entityId: copy.id, previous: { from: eventId } });
    return { ok: true, message: "Copied as a draft.", redirect: `/admin/manage/events/${copy.id}` };
  });
}

export async function cancelEventAction(eventId: string): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("events.publish");
    const event = await prisma.event.findFirst({ where: { id: id.parse(eventId), deletedAt: null } });
    if (!event) throw new UserError("Event not found.");
    if (event.status === "CANCELLED") throw new UserError("This event is already cancelled.");
    await prisma.event.update({ where: { id: event.id }, data: { status: "CANCELLED", registrationOpen: false, featured: false } });
    const regs = await prisma.eventRegistration.findMany({ where: { eventId: event.id, status: { in: ["PENDING", "CONFIRMED"] } }, select: { userId: true, amountPaid: true, orderItem: { select: { order: { select: { status: true } } } } } });
    const ids: string[] = [];
    for (const userId of new Set(regs.map((r) => r.userId))) {
      ids.push((await notify({ userId, type: "EVENT_REGISTERED", title: `${event.title} is cancelled`, body: `Sorry — ${event.title} has been cancelled. If you paid, the club will contact you about a refund.`, link: `/events/${event.slug}` })).id);
    }
    await emailNotifications(ids);
    const paid = regs.filter((r) => r.amountPaid.greaterThan(0) || r.orderItem?.order.status === "PAID").length;
    if (paid) await alertAdmins("Refunds to review", `${event.title} was cancelled with ${paid} paid registration(s).`, `/admin/registrations?event=${event.id}`);
    await audit({ actorId: actor.id, action: "events.cancel", entity: "events", entityId: event.id, previous: { status: event.status }, next: { notified: ids.length, paid } });
    revalidatePath("/", "layout");
    return { ok: true, message: `Event cancelled — ${ids.length} registrant(s) notified.` };
  });
}

export async function setEventArchivedAction(eventId: string, archive: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("events.publish");
    const event = await prisma.event.findFirst({ where: { id: id.parse(eventId), deletedAt: null } });
    if (!event) throw new UserError("Event not found.");
    await prisma.event.update({ where: { id: event.id }, data: archive ? { archivedAt: new Date(), featured: false } : { archivedAt: null } });
    await audit({ actorId: actor.id, action: archive ? "events.archive" : "events.unarchive", entity: "events", entityId: event.id });
    revalidatePath("/", "layout");
    return { ok: true, message: archive ? "Archived — hidden from the website, records kept." : "Restored from the archive." };
  });
}

/** Staff-verified bank / cash / M-Pesa (Paybill) payment for chosen sessions. */
export async function recordRegistrationPaymentAction(registrationId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("events.manage");
    const data = parseForm(
      z.object({
        method: z.string().trim().min(2, "Choose a method").max(40),
        reference: z.string().trim().min(3, "Enter the transaction reference you verified").max(80),
        note: z.string().trim().max(300).optional(),
      }),
      formData,
    );
    const itemIds = formData.getAll("item").map(String);
    if (!itemIds.length) throw new UserError("Tick the sessions this payment covers.");
    const reg = await prisma.eventRegistration.findUnique({ where: { id: id.parse(registrationId) }, include: { items: true } });
    if (!reg) throw new UserError("Registration not found.");
    if (itemIds.some((i) => !reg.items.some((x) => x.id === i))) throw new UserError("Unknown session selected.");
    const result = await prisma.$transaction((tx) => recordItemPayments(tx, itemIds, { method: data.method, reference: data.reference, note: data.note || null, recordedById: actor.id }));
    if (result.alreadyPaid.length) throw new UserError("Some of those sessions were already paid — refresh and try again.");
    const updated = result.updated[0];
    await audit({ actorId: actor.id, action: "event_registration.payment_verified", entity: "EventRegistration", entityId: reg.id, next: { itemIds, method: data.method, reference: data.reference, amount: updated?.amount.toString() } });
    if (updated) {
      const n = await notify({ userId: reg.userId, type: "EVENT_REGISTERED", title: `${updated.registration.event.title}: payment verified`, body: `We verified your ${data.method} payment (${data.reference}) for ${reg.participantName ?? "your registration"}.`, link: registrationPath(reg.reference) });
      await emailNotifications([n.id]);
    }
    return { ok: true, message: "Payment recorded." };
  });
}

export async function resendRegistrationEmailAction(registrationId: string): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("events.manage");
    const sent = await sendRegistrationEmail(id.parse(registrationId));
    await audit({ actorId: actor.id, action: "event_registration.resend", entity: "EventRegistration", entityId: registrationId });
    return { ok: true, message: sent ? "Booking email sent." : "Email isn't configured or the registration has no email." };
  });
}
