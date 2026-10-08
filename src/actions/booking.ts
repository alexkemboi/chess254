"use server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertUser, currentUser } from "@/server/auth";
import { runAction, UserError, type ActionResult } from "@/server/errors";
import { bookableSessionType, bookingContext, cancelBooking, computeSlots, createBooking, monthAvailability, quoteBooking } from "@/server/booking";
import { emailNotifications, alertAdmins } from "@/server/notifications";
import { rateLimit } from "@/server/rate-limit";
import { audit } from "@/server/audit";
import { isValidDateKey } from "@/lib/time";
import { formatMoney } from "@/lib/format";

const id = z.string().min(1).max(40);

export async function monthAvailabilityAction(sessionTypeId: string, month: string, coachId?: string): Promise<ActionResult<{ date: string; slots: number }[]>> {
  return runAction(async () => {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new UserError("Invalid month.");
    return { ok: true, data: await monthAvailability(id.parse(sessionTypeId), month, coachId ? id.parse(coachId) : undefined) };
  });
}

export type DaySlot = { coachId: string; coachName: string; coachImage: string | null; startsAt: string; endsAt: string; remaining: number; capacity: number };

export async function daySlotsAction(sessionTypeId: string, date: string, coachId?: string): Promise<ActionResult<DaySlot[]>> {
  return runAction(async () => {
    if (!isValidDateKey(date)) throw new UserError("Invalid date.");
    const st = await bookableSessionType(id.parse(sessionTypeId));
    if (!st) throw new UserError("This session type is not available.");
    const ctx = await bookingContext();
    const coachIds = st.coaches.map((c) => c.id).filter((c) => !coachId || c === coachId);
    const slots = await computeSlots(ctx, st, coachIds, date);
    const coaches = await prisma.coachProfile.findMany({ where: { id: { in: coachIds } }, select: { id: true, imageUrl: true, user: { select: { name: true } } } });
    const byId = new Map(coaches.map((c) => [c.id, c]));
    return { ok: true, data: slots.map((s) => ({ ...s, coachName: byId.get(s.coachId)?.user.name ?? "Coach", coachImage: byId.get(s.coachId)?.imageUrl ?? null })) };
  });
}

export async function quoteAction(sessionTypeId: string, startsAt: string): Promise<ActionResult<{ label: string; included: boolean; free: boolean }>> {
  return runAction(async () => {
    const user = await currentUser();
    if (!user) return { ok: true, data: { label: "Sign in to see your price", included: false, free: false } };
    const q = await quoteBooking(user.id, id.parse(sessionTypeId), new Date(startsAt));
    const free = !q.price.greaterThan(0);
    return { ok: true, data: { label: q.usedEntitlement ? "Included in your membership" : free ? "Free" : formatMoney(q.price, q.currency), included: q.usedEntitlement, free } };
  });
}

export async function createBookingAction(input: { sessionTypeId: string; coachId: string; startsAt: string; notes?: string }): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    if (!(await rateLimit(`book:${user.id}`, 20, 3600))) throw new UserError("Too many booking attempts. Please try again later.");
    const data = z
      .object({ sessionTypeId: id, coachId: id, startsAt: z.string().datetime(), notes: z.string().trim().max(1000).optional() })
      .parse(input);
    const { booking, orderId } = await createBooking(user.id, { ...data, startsAt: new Date(data.startsAt) });
    if (orderId) return { ok: true, message: "Slot held — complete payment to confirm.", redirect: `/pay/${orderId}` };
    const latest = await prisma.notification.findFirst({ where: { userId: user.id, type: "BOOKING_CONFIRMED" }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (latest) await emailNotifications([latest.id]);
    return { ok: true, message: `Booked! Reference ${booking.reference}`, redirect: "/dashboard/bookings" };
  });
}

export async function cancelMyBookingAction(bookingId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const reason = z.string().trim().max(300).optional().parse(formData.get("reason") ?? undefined);
    const result = await cancelBooking(id.parse(bookingId), { id: user.id, asStaff: false }, reason);
    await emailNotifications([result.notificationId]);
    if (result.paid) await alertAdmins("Paid booking cancelled", `Booking ${result.booking.reference} was cancelled by the member after payment. Review the refund per policy.`, "/admin/bookings");
    await audit({ actorId: user.id, action: "booking.cancel", entity: "Booking", entityId: bookingId, previous: { status: result.booking.status } });
    return { ok: true, message: "Booking cancelled." };
  });
}
