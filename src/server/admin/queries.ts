import "server-only";
import type { BookingStatus, Prisma } from "@prisma/client";
import { zonedTimeToUtc, addDaysToKey, isValidDateKey } from "@/lib/time";

export type BookingFilters = { coach?: string; member?: string; status?: string; from?: string; to?: string };
const STATUSES: BookingStatus[] = ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW", "EXPIRED"];

/** Shared by the bookings screen and its CSV export so both show the same rows. */
export function bookingWhere(f: BookingFilters, tz: string): Prisma.BookingWhereInput {
  const range: Prisma.DateTimeFilter = {};
  if (f.from && isValidDateKey(f.from)) range.gte = zonedTimeToUtc(f.from, "00:00", tz);
  if (f.to && isValidDateKey(f.to)) range.lt = zonedTimeToUtc(addDaysToKey(f.to, 1), "00:00", tz);
  return {
    ...(f.coach ? { coachId: f.coach } : {}),
    ...(STATUSES.includes(f.status as BookingStatus) ? { status: f.status as BookingStatus } : {}),
    ...(f.member ? { member: { OR: [{ name: { contains: f.member, mode: "insensitive" } }, { email: { contains: f.member, mode: "insensitive" } }] } } : {}),
    ...(range.gte || range.lt ? { startsAt: range } : {}),
  };
}

export function csv(rows: (string | number | null | undefined)[][]) {
  return rows
    .map((r) => r.map((v) => {
      const s = v === null || v === undefined ? "" : String(v);
      // Neutralise spreadsheet formula injection.
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    }).join(","))
    .join("\n");
}
