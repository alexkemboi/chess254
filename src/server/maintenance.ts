import "server-only";
import { prisma } from "@/server/db";
import { getAllSettings } from "@/server/settings";
import { notify, emailNotifications } from "@/server/notifications";
import { sweepPayments } from "@/server/payments/service";
import { pruneRateLimits } from "@/server/rate-limit";
import { formatDate, formatDateTime } from "@/lib/format";

/** Idempotent housekeeping, safe to run every few minutes from a scheduler. */
export async function runMaintenance() {
  const settings = await getAllSettings();
  const tz = settings.general.timezone;
  const now = new Date();
  const ids: string[] = [];

  const payments = await sweepPayments();

  // Memberships past their end date.
  const lapsed = await prisma.membership.findMany({ where: { status: "ACTIVE", expiresAt: { lte: now } }, include: { plan: true } });
  for (const m of lapsed) {
    const { count } = await prisma.membership.updateMany({ where: { id: m.id, status: "ACTIVE" }, data: { status: "EXPIRED" } });
    if (count) ids.push((await notify({ userId: m.userId, type: "MEMBERSHIP_EXPIRED", title: "Membership expired", body: `Your ${m.plan.name} membership has ended. Renew any time to keep playing.`, link: "/memberships" })).id);
  }

  // Expiry reminders.
  const reminderCutoff = new Date(now.getTime() + settings.membership.renewalReminderDays * 86400_000);
  if (settings.membership.renewalReminderDays > 0) {
    const expiring = await prisma.membership.findMany({ where: { status: "ACTIVE", expiresAt: { gt: now, lte: reminderCutoff }, expiryReminderAt: null }, include: { plan: true } });
    for (const m of expiring) {
      const { count } = await prisma.membership.updateMany({ where: { id: m.id, expiryReminderAt: null }, data: { expiryReminderAt: now } });
      if (count) ids.push((await notify({ userId: m.userId, type: "MEMBERSHIP_EXPIRING", title: "Membership ending soon", body: `Your ${m.plan.name} membership ends on ${formatDate(m.expiresAt!, tz)}.`, link: "/dashboard/membership" })).id);
    }
  }

  // Booking reminders.
  const reminderWindow = new Date(now.getTime() + settings.notifications.bookingReminderHours * 3600_000);
  const upcoming = await prisma.booking.findMany({ where: { status: "CONFIRMED", reminderSentAt: null, startsAt: { gt: now, lte: reminderWindow } }, include: { sessionType: true, coach: { include: { user: true } } } });
  for (const b of upcoming) {
    const { count } = await prisma.booking.updateMany({ where: { id: b.id, reminderSentAt: null }, data: { reminderSentAt: now } });
    if (count) ids.push((await notify({ userId: b.memberId, type: "BOOKING_REMINDER", title: "Session reminder", body: `${b.sessionType.name} with ${b.coach.user.name} — ${formatDateTime(b.startsAt, tz)}.`, link: "/dashboard/bookings" })).id);
  }

  // Event reminders.
  const regs = await prisma.eventRegistration.findMany({ where: { status: "CONFIRMED", reminderSentAt: null, event: { startsAt: { gt: now, lte: reminderWindow } } }, include: { event: true } });
  for (const r of regs) {
    const { count } = await prisma.eventRegistration.updateMany({ where: { id: r.id, reminderSentAt: null }, data: { reminderSentAt: now } });
    if (count) ids.push((await notify({ userId: r.userId, type: "BOOKING_REMINDER", title: "Event reminder", body: `${r.event.title} — ${formatDateTime(r.event.startsAt, tz)}.`, link: `/events/${r.event.slug}` })).id);
  }

  // Day passes that ran out.
  await prisma.servicePurchase.updateMany({ where: { status: "ACTIVE", validUntil: { lt: now } }, data: { status: "EXPIRED" } });

  await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  await pruneRateLimits();
  await emailNotifications(ids);
  return { payments, membershipsExpired: lapsed.length, notifications: ids.length };
}
