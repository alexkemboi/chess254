import "server-only";
import { Prisma, type RegistrationStatus } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import { UserError } from "@/server/errors";
import { randomReference } from "@/server/crypto";
import { createOrder } from "@/server/orders";
import { getAllSettings } from "@/server/settings";
import { activeMemberships } from "@/server/memberships";
import { notify } from "@/server/notifications";
import { formatDateTime } from "@/lib/format";

const HOLDING: RegistrationStatus[] = ["PENDING", "CONFIRMED", "ATTENDED"];

export function seatHoldingWhere(eventId: string, now = new Date()): Prisma.EventRegistrationWhereInput {
  return { eventId, status: { in: HOLDING }, OR: [{ status: { not: "PENDING" } }, { holdExpiresAt: { gt: now } }] };
}

export async function seatsTaken(eventId: string, db: Tx | typeof prisma = prisma) {
  return db.eventRegistration.count({ where: seatHoldingWhere(eventId) });
}

export function registrationClosedReason(event: { status: string; registrationOpen: boolean; registrationDeadline: Date | null; startsAt: Date; deletedAt: Date | null }) {
  if (event.deletedAt || event.status !== "PUBLISHED") return "Registration is not open for this event.";
  if (!event.registrationOpen) return "Registration is closed.";
  if (event.registrationDeadline && event.registrationDeadline < new Date()) return "The registration deadline has passed.";
  if (event.startsAt < new Date()) return "This event has already started.";
  return null;
}

/** Member price applies when the event defines one and the user has an active membership. */
export async function eventPriceFor(event: { price: Prisma.Decimal; memberPrice: Prisma.Decimal | null }, userId: string | null) {
  if (!userId || event.memberPrice === null) return { price: event.price, member: false };
  const memberships = await activeMemberships(userId);
  if (memberships.length === 0) return { price: event.price, member: false };
  return { price: Prisma.Decimal.min(event.price, event.memberPrice), member: true };
}

export async function registerForEvent(userId: string, eventId: string) {
  const settings = await getAllSettings();
  return prisma.$transaction(async (tx) => {
    // Row lock serialises registrations so capacity can never be exceeded.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
    if (!locked.length) throw new UserError("Event not found.");
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, include: { location: true } });
    const closed = registrationClosedReason(event);
    if (closed) throw new UserError(closed);

    const existing = await tx.eventRegistration.findUnique({ where: { eventId_userId: { eventId, userId } }, include: { orderItem: true } });
    const now = new Date();
    if (existing && (existing.status === "CONFIRMED" || existing.status === "ATTENDED")) throw new UserError("You are already registered for this event.");
    if (existing && existing.status === "PENDING" && existing.holdExpiresAt && existing.holdExpiresAt > now && existing.orderItem) {
      return { registration: existing, orderId: existing.orderItem.orderId };
    }

    if (event.capacity !== null) {
      const taken = await tx.eventRegistration.count({ where: { ...seatHoldingWhere(eventId, now), ...(existing ? { id: { not: existing.id } } : {}) } });
      if (taken >= event.capacity) throw new UserError("This event is full.");
    }

    const { price } = await eventPriceFor(event, userId);
    const paid = price.greaterThan(0);
    const holdExpiresAt = paid ? new Date(now.getTime() + settings.booking.holdMinutes * 60_000) : null;
    const data = { status: (paid ? "PENDING" : "CONFIRMED") as RegistrationStatus, price, currency: event.currency, holdExpiresAt, cancelledAt: null };

    let registration;
    if (existing) {
      // A previous registration (cancelled / expired) is revived; its old order item is detached.
      if (existing.orderItem) await tx.orderItem.update({ where: { id: existing.orderItem.id }, data: { eventRegistrationId: null } });
      registration = await tx.eventRegistration.update({ where: { id: existing.id }, data });
    } else {
      registration = await tx.eventRegistration.create({ data: { ...data, reference: randomReference("EV"), eventId, userId } });
    }

    if (!paid) {
      await notify(
        { userId, type: "EVENT_REGISTERED", title: "You're registered", body: `${event.title} — ${formatDateTime(event.startsAt, settings.general.timezone)}.`, link: "/dashboard/events" },
        tx,
      );
      return { registration, orderId: null };
    }
    const order = await createOrder(tx, {
      userId,
      currency: event.currency,
      expiresAt: holdExpiresAt!,
      lines: [{ type: "EVENT", description: `${event.title} registration`, unitPrice: price, eventId: event.id, eventRegistrationId: registration.id }],
    });
    return { registration, orderId: order.id };
  });
}

/** Confirms a paid registration; if the hold lapsed, re-checks capacity first. */
export async function confirmPaidRegistration(tx: Tx, registrationId: string) {
  const reg = await tx.eventRegistration.findUnique({ where: { id: registrationId }, include: { event: true } });
  if (!reg) return { ok: false as const, reason: "Registration not found" };
  if (reg.status === "CONFIRMED" || reg.status === "ATTENDED") return { ok: true as const, registration: reg };
  await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${reg.eventId} FOR UPDATE`;
  const lapsed = reg.status === "EXPIRED" || (reg.holdExpiresAt !== null && reg.holdExpiresAt < new Date());
  if (lapsed && reg.event.capacity !== null) {
    const taken = await tx.eventRegistration.count({ where: { ...seatHoldingWhere(reg.eventId), id: { not: reg.id } } });
    if (taken >= reg.event.capacity) {
      await tx.eventRegistration.update({ where: { id: reg.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
      return { ok: false as const, reason: "Event full at payment time" };
    }
  }
  if (!["PENDING", "EXPIRED"].includes(reg.status)) return { ok: false as const, reason: `Registration is ${reg.status.toLowerCase()}` };
  const updated = await tx.eventRegistration.update({ where: { id: reg.id }, data: { status: "CONFIRMED", holdExpiresAt: null } });
  return { ok: true as const, registration: updated };
}

export async function cancelRegistration(registrationId: string, actor: { id: string; asStaff: boolean }) {
  const settings = await getAllSettings();
  return prisma.$transaction(async (tx) => {
    const reg = await tx.eventRegistration.findUnique({ where: { id: registrationId }, include: { event: true, orderItem: { include: { order: true } } } });
    if (!reg || (!actor.asStaff && reg.userId !== actor.id)) throw new UserError("Registration not found.");
    if (!["PENDING", "CONFIRMED"].includes(reg.status)) throw new UserError("This registration cannot be cancelled.");
    if (!actor.asStaff && reg.status === "CONFIRMED" && reg.event.startsAt.getTime() - Date.now() < settings.events.cancellationHours * 3600_000) {
      throw new UserError(`Registrations can be cancelled up to ${settings.events.cancellationHours} hours before the event.`);
    }
    await tx.eventRegistration.update({ where: { id: reg.id }, data: { status: "CANCELLED", cancelledAt: new Date(), holdExpiresAt: null } });
    if (reg.orderItem?.order.status === "PENDING") await tx.order.update({ where: { id: reg.orderItem.orderId }, data: { status: "CANCELLED" } });
    return { registration: reg, paid: reg.orderItem?.order.status === "PAID" };
  });
}
