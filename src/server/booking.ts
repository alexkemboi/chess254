import "server-only";
import { Prisma, type BookingStatus, type EntitlementPeriod } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import { getAllSettings } from "@/server/settings";
import { UserError } from "@/server/errors";
import { randomReference } from "@/server/crypto";
import { createOrder } from "@/server/orders";
import { addDaysToKey, clockOf, dateKeyInZone, minutesOf, weekdayOfKey, zonedParts, zonedTimeToUtc } from "@/lib/time";
import { activeMemberships } from "@/server/memberships";
import { notify } from "@/server/notifications";
import { formatDateTime } from "@/lib/format";

/** Statuses that occupy a coach's time. PENDING only counts while its payment hold is live. */
const OCCUPYING: BookingStatus[] = ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW"];

export type Slot = { coachId: string; startsAt: string; endsAt: string; remaining: number; capacity: number };

export async function bookingContext() {
  const settings = await getAllSettings();
  const location = await prisma.location.findFirst({
    where: { active: true },
    orderBy: [{ isPrimary: "desc" }, { position: "asc" }],
    include: { openingHours: true },
  });
  const timezone = location?.timezone || settings.general.timezone;
  return { settings, location, timezone };
}

type Ctx = Awaited<ReturnType<typeof bookingContext>>;
type SessionTypeLite = { id: string; durationMinutes: number; capacity: number; minNoticeHours: number | null; maxAdvanceDays: number | null };

function occupyingWhere(now: Date): Prisma.BookingWhereInput {
  return { status: { in: OCCUPYING }, OR: [{ status: { not: "PENDING" } }, { holdExpiresAt: { gt: now } }] };
}

/**
 * All bookable slots for the given coaches on one local date. Enforces
 * clubhouse hours, closures, coach weekly availability, time off, notice and
 * advance windows, existing bookings, live payment holds and group capacity.
 */
export async function computeSlots(
  ctx: Ctx,
  sessionType: SessionTypeLite,
  coachIds: string[],
  dateKey: string,
  opts: { now?: Date; excludeBookingId?: string; db?: Tx | typeof prisma } = {},
): Promise<Slot[]> {
  const db = opts.db ?? prisma;
  const now = opts.now ?? new Date();
  const { location, timezone, settings } = ctx;
  if (!location || coachIds.length === 0) return [];

  const weekday = weekdayOfKey(dateKey);
  const hours = location.openingHours.find((h) => h.weekday === weekday);
  if (!hours || hours.closed) return [];
  const closure = await db.closureDate.findFirst({ where: { locationId: location.id, date: new Date(`${dateKey}T00:00:00Z`) } });
  if (closure) return [];

  const minNotice = (sessionType.minNoticeHours ?? settings.booking.minNoticeHours) * 3600_000;
  const maxAdvance = (sessionType.maxAdvanceDays ?? settings.booking.maxAdvanceDays) * 86400_000;
  const step = settings.booking.slotIntervalMinutes;
  const duration = sessionType.durationMinutes;
  const dayStart = zonedTimeToUtc(dateKey, "00:00", timezone);
  const dayEnd = zonedTimeToUtc(addDaysToKey(dateKey, 1), "00:00", timezone);

  const [availability, timeOff, bookings] = await Promise.all([
    db.coachAvailability.findMany({ where: { coachId: { in: coachIds }, weekday } }),
    db.coachTimeOff.findMany({ where: { coachId: { in: coachIds }, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } } }),
    db.booking.findMany({
      where: { coachId: { in: coachIds }, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart }, ...occupyingWhere(now), ...(opts.excludeBookingId ? { id: { not: opts.excludeBookingId } } : {}) },
      select: { coachId: true, startsAt: true, endsAt: true, sessionTypeId: true },
    }),
  ]);

  const openMin = minutesOf(hours.opensAt);
  const closeMin = minutesOf(hours.closesAt);
  const slots: Slot[] = [];

  for (const coachId of coachIds) {
    const windows = availability
      .filter((a) => a.coachId === coachId)
      .map((a) => [Math.max(minutesOf(a.startTime), openMin), Math.min(minutesOf(a.endTime), closeMin)] as const)
      .filter(([s, e]) => e - s >= duration)
      .sort((a, b) => a[0] - b[0]);
    const seen = new Set<number>();
    for (const [winStart, winEnd] of windows) {
      for (let m = winStart; m + duration <= winEnd; m += step) {
        if (seen.has(m)) continue;
        seen.add(m);
        const startsAt = zonedTimeToUtc(dateKey, clockOf(m), timezone);
        const endsAt = new Date(startsAt.getTime() + duration * 60_000);
        if (startsAt.getTime() < now.getTime() + minNotice) continue;
        if (startsAt.getTime() > now.getTime() + maxAdvance) continue;
        if (timeOff.some((t) => t.coachId === coachId && t.startsAt < endsAt && t.endsAt > startsAt)) continue;
        const overlapping = bookings.filter((b) => b.coachId === coachId && b.startsAt < endsAt && b.endsAt > startsAt);
        let remaining = sessionType.capacity;
        let blocked = false;
        for (const b of overlapping) {
          const sameGroup = sessionType.capacity > 1 && b.sessionTypeId === sessionType.id && b.startsAt.getTime() === startsAt.getTime();
          if (sameGroup) remaining -= 1;
          else blocked = true;
        }
        if (blocked || remaining <= 0) continue;
        slots.push({ coachId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), remaining, capacity: sessionType.capacity });
      }
    }
  }
  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export async function bookableSessionType(sessionTypeId: string) {
  return prisma.sessionType.findFirst({
    where: { id: sessionTypeId, status: "ACTIVE" },
    include: {
      coaches: { where: { isActive: true, acceptsBookings: true, user: { suspendedAt: null, deletedAt: null } }, select: { id: true } },
      allowedPlans: { select: { id: true, name: true } },
    },
  });
}

/** Days in a month (local) that have at least one free slot, for the calendar. */
export async function monthAvailability(sessionTypeId: string, monthKey: string, coachId?: string) {
  const ctx = await bookingContext();
  const st = await bookableSessionType(sessionTypeId);
  if (!st) return [];
  const coachIds = st.coaches.map((c) => c.id).filter((id) => !coachId || id === coachId);
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = dateKeyInZone(new Date(), ctx.timezone);
  const out: { date: string; slots: number }[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${monthKey}-${String(d).padStart(2, "0")}`;
    if (key < today) continue;
    const slots = await computeSlots(ctx, st, coachIds, key);
    if (slots.length) out.push({ date: key, slots: slots.length });
  }
  return out;
}

function periodWindow(period: EntitlementPeriod, at: Date, timezone: string, membership: { startsAt: Date | null; expiresAt: Date | null }) {
  if (period === "BILLING_PERIOD") return { from: membership.startsAt ?? at, to: membership.expiresAt ?? at };
  const key = dateKeyInZone(at, timezone);
  if (period === "WEEK") {
    const p = zonedParts(at, timezone);
    const mondayKey = addDaysToKey(key, -((p.weekday + 6) % 7));
    return { from: zonedTimeToUtc(mondayKey, "00:00", timezone), to: zonedTimeToUtc(addDaysToKey(mondayKey, 7), "00:00", timezone) };
  }
  const monthStart = `${key.slice(0, 7)}-01`;
  const [y, m] = monthStart.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { from: zonedTimeToUtc(monthStart, "00:00", timezone), to: zonedTimeToUtc(nextMonth, "00:00", timezone) };
}

/** Works out whether the member may book this session type, and at what price. */
export async function quoteBooking(userId: string, sessionTypeId: string, startsAt: Date, db: Tx | typeof prisma = prisma) {
  const ctx = await bookingContext();
  const st = await db.sessionType.findUnique({ where: { id: sessionTypeId }, include: { allowedPlans: { select: { id: true } }, entitlements: true } });
  if (!st || st.status !== "ACTIVE") throw new UserError("This session type is not available for booking.");
  const memberships = await activeMemberships(userId, db);
  const eligible = memberships.filter((m) => m.plan.canBookCoaching && (st.allowedPlans.length === 0 || st.allowedPlans.some((p) => p.id === m.planId)));
  if (st.membershipRequired && eligible.length === 0) {
    throw new UserError(st.allowedPlans.length ? "This session needs a membership plan that includes it." : "This session is for active members.");
  }
  const now = new Date();
  for (const m of memberships) {
    const ent = st.entitlements.find((e) => e.planId === m.planId);
    if (!ent || (m.expiresAt && m.expiresAt < startsAt)) continue;
    const { from, to } = periodWindow(ent.period, startsAt, ctx.timezone, m);
    const used = await db.booking.count({
      where: { memberId: userId, sessionTypeId, usedEntitlement: true, startsAt: { gte: from, lt: to }, ...occupyingWhere(now) },
    });
    if (used < ent.quantity) return { price: new Prisma.Decimal(0), currency: st.currency, usedEntitlement: true, sessionType: st, ctx };
  }
  return { price: st.price, currency: st.currency, usedEntitlement: false, sessionType: st, ctx };
}

async function lock(tx: Tx, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** Re-validates the exact slot while holding the coach and member locks. */
async function assertSlotFree(tx: Tx, ctx: Ctx, st: SessionTypeLite, coachId: string, startsAt: Date, memberId: string, excludeBookingId?: string) {
  const dateKey = dateKeyInZone(startsAt, ctx.timezone);
  const slots = await computeSlots(ctx, st, [coachId], dateKey, { db: tx, excludeBookingId });
  if (!slots.some((s) => s.startsAt === startsAt.toISOString())) {
    throw new UserError("That time is no longer available. Please pick another slot.");
  }
  const endsAt = new Date(startsAt.getTime() + st.durationMinutes * 60_000);
  const clash = await tx.booking.findFirst({
    where: { memberId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, ...occupyingWhere(new Date()), ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}) },
  });
  if (clash) throw new UserError("You already have a session booked at that time.");
  return endsAt;
}

export async function createBooking(userId: string, input: { sessionTypeId: string; coachId: string; startsAt: Date; notes?: string }) {
  const st = await bookableSessionType(input.sessionTypeId);
  if (!st) throw new UserError("This session type is not available for booking.");
  if (!st.coaches.some((c) => c.id === input.coachId)) throw new UserError("This coach is not taking bookings for this session.");

  const { settings } = await bookingContext();
  const active = await prisma.booking.count({ where: { memberId: userId, startsAt: { gt: new Date() }, ...occupyingWhere(new Date()) } });
  if (active >= settings.booking.maxActiveBookingsPerMember) throw new UserError("You have reached the maximum number of upcoming bookings.");

  const result = await prisma.$transaction(
    async (tx) => {
      await lock(tx, `member:${userId}`);
      await lock(tx, `coach:${input.coachId}`);
      const quote = await quoteBooking(userId, input.sessionTypeId, input.startsAt, tx);
      const endsAt = await assertSlotFree(tx, quote.ctx, st, input.coachId, input.startsAt, userId);
      const paid = quote.price.greaterThan(0);
      const holdExpiresAt = paid ? new Date(Date.now() + settings.booking.holdMinutes * 60_000) : null;
      const booking = await tx.booking.create({
        data: {
          reference: randomReference("BK"),
          memberId: userId,
          coachId: input.coachId,
          sessionTypeId: st.id,
          locationId: quote.ctx.location?.id,
          startsAt: input.startsAt,
          endsAt,
          status: paid ? "PENDING" : "CONFIRMED",
          price: quote.price,
          currency: quote.currency,
          usedEntitlement: quote.usedEntitlement,
          holdExpiresAt,
          memberNotes: input.notes || null,
          history: { create: { status: paid ? "PENDING" : "CONFIRMED", actorId: userId, note: quote.usedEntitlement ? "Included in membership" : paid ? "Awaiting payment" : "Free session" } },
        },
      });
      let orderId: string | null = null;
      if (paid) {
        const order = await createOrder(tx, {
          userId,
          currency: quote.currency,
          expiresAt: holdExpiresAt!,
          lines: [{ type: "BOOKING", description: `${st.name} · ${formatDateTime(input.startsAt, quote.ctx.timezone)}`, unitPrice: quote.price, bookingId: booking.id }],
        });
        orderId = order.id;
      } else {
        await notify(
          { userId, type: "BOOKING_CONFIRMED", title: "Session booked", body: `${st.name} on ${formatDateTime(input.startsAt, quote.ctx.timezone)} is confirmed.`, link: "/dashboard/bookings" },
          tx,
        );
      }
      return { booking, orderId };
    },
    { timeout: 20_000 },
  );
  return result;
}

/** Confirms a paid booking; re-validates the slot if its hold lapsed before payment arrived. */
export async function confirmPaidBooking(tx: Tx, bookingId: string) {
  const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { sessionType: true } });
  if (!booking) return { ok: false as const, reason: "Booking not found" };
  if (booking.status === "CONFIRMED" || booking.status === "COMPLETED") return { ok: true as const, booking };
  if (booking.status === "EXPIRED" || (booking.status === "PENDING" && booking.holdExpiresAt && booking.holdExpiresAt < new Date())) {
    await lock(tx, `member:${booking.memberId}`);
    await lock(tx, `coach:${booking.coachId}`);
    const ctx = await bookingContext();
    try {
      await assertSlotFree(tx, ctx, { ...booking.sessionType, minNoticeHours: 0, maxAdvanceDays: 3650 }, booking.coachId, booking.startsAt, booking.memberId, booking.id);
    } catch {
      await tx.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Paid after the hold expired and the slot was taken — refund due" } });
      await tx.bookingStatusHistory.create({ data: { bookingId: booking.id, status: "CANCELLED", note: "Slot unavailable at payment time; refund required" } });
      return { ok: false as const, reason: "Slot no longer available" };
    }
  } else if (booking.status !== "PENDING") {
    return { ok: false as const, reason: `Booking is ${booking.status.toLowerCase()}` };
  }
  const updated = await tx.booking.update({ where: { id: booking.id }, data: { status: "CONFIRMED", holdExpiresAt: null } });
  await tx.bookingStatusHistory.create({ data: { bookingId: booking.id, status: "CONFIRMED", note: "Payment received" } });
  return { ok: true as const, booking: updated };
}

export async function cancelBooking(bookingId: string, actor: { id: string; asStaff: boolean }, reason?: string) {
  const ctx = await bookingContext();
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { sessionType: true, orderItem: { include: { order: true } } } });
    if (!booking) throw new UserError("Booking not found.");
    if (!actor.asStaff && booking.memberId !== actor.id) throw new UserError("Booking not found.");
    if (!["PENDING", "CONFIRMED"].includes(booking.status)) throw new UserError("This booking can no longer be cancelled.");
    const paid = booking.orderItem?.order.status === "PAID";
    if (!actor.asStaff && booking.status === "CONFIRMED") {
      const hours = booking.sessionType.cancellationHours ?? ctx.settings.booking.cancellationHours;
      if (booking.startsAt.getTime() - Date.now() < hours * 3600_000) throw new UserError(`Bookings can only be cancelled at least ${hours} hours before the session.`);
    }
    await tx.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason || null, holdExpiresAt: null } });
    await tx.bookingStatusHistory.create({ data: { bookingId: booking.id, status: "CANCELLED", actorId: actor.id, note: reason || (actor.asStaff ? "Cancelled by staff" : "Cancelled by member") } });
    if (booking.orderItem && booking.orderItem.order.status === "PENDING") {
      await tx.order.update({ where: { id: booking.orderItem.orderId }, data: { status: "CANCELLED" } });
    }
    const n = await notify(
      {
        userId: booking.memberId,
        type: "BOOKING_CANCELLED",
        title: "Booking cancelled",
        body: `${booking.sessionType.name} on ${formatDateTime(booking.startsAt, ctx.timezone)} was cancelled.${paid ? " Our team will contact you about your refund in line with the cancellation policy." : ""}`,
        link: "/dashboard/bookings",
      },
      tx,
    );
    return { booking, paid, notificationId: n.id };
  });
}

export async function rescheduleBooking(bookingId: string, actorId: string, input: { startsAt: Date; coachId?: string }) {
  const ctx = await bookingContext();
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { sessionType: { include: { coaches: { select: { id: true } } } } } });
    if (!booking) throw new UserError("Booking not found.");
    if (!["PENDING", "CONFIRMED"].includes(booking.status)) throw new UserError("Only upcoming bookings can be rescheduled.");
    const coachId = input.coachId || booking.coachId;
    if (!booking.sessionType.coaches.some((c) => c.id === coachId)) throw new UserError("That coach does not offer this session type.");
    await lock(tx, `member:${booking.memberId}`);
    await lock(tx, `coach:${coachId}`);
    const endsAt = await assertSlotFree(tx, ctx, { ...booking.sessionType, minNoticeHours: 0 }, coachId, input.startsAt, booking.memberId, booking.id);
    const updated = await tx.booking.update({ where: { id: booking.id }, data: { startsAt: input.startsAt, endsAt, coachId } });
    await tx.bookingStatusHistory.create({ data: { bookingId: booking.id, status: booking.status, actorId, note: `Rescheduled from ${booking.startsAt.toISOString()}` } });
    const n = await notify(
      { userId: booking.memberId, type: "BOOKING_RESCHEDULED", title: "Booking rescheduled", body: `${booking.sessionType.name} moved to ${formatDateTime(input.startsAt, ctx.timezone)}.`, link: "/dashboard/bookings" },
      tx,
    );
    return { previous: booking, booking: updated, notificationId: n.id };
  });
}
