import "server-only";
import { z } from "zod";
import { isValidClock, zonedTimeToUtc, dateKeyInZone, zonedParts } from "@/lib/time";
import { slugify } from "@/lib/utils";

/** Zod building blocks for admin form posts (everything arrives as strings). */
export const f = {
  text: (max = 200) => z.string().trim().min(1, "Required").max(max),
  optText: (max = 2000) => z.string().trim().max(max).optional().transform((v) => (v ? v : null)),
  slug: () => z.string().trim().max(80).optional().transform((v) => v ?? ""),
  int: (min = 0, max = 1_000_000) => z.coerce.number({ message: "Enter a number" }).int("Whole numbers only").min(min).max(max),
  optInt: (min = 0, max = 1_000_000) => z.union([z.literal(""), z.coerce.number().int().min(min).max(max)]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
  money: () => z.coerce.number({ message: "Enter an amount" }).min(0).max(10_000_000).transform((v) => Math.round(v * 100) / 100),
  optMoney: () => z.union([z.literal(""), z.coerce.number().min(0).max(10_000_000)]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
  bool: () => z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()),
  clock: () => z.string().refine(isValidClock, "Use HH:MM"),
  optClock: () => z.union([z.literal(""), z.string().refine(isValidClock, "Use HH:MM")]).optional().transform((v) => v || null),
  url: () => z.union([z.literal(""), z.string().trim().refine((v) => v.startsWith("/") || /^https?:\/\//.test(v), "Use a full URL or a /path")]).optional().transform((v) => v || null),
  email: () => z.union([z.literal(""), z.string().trim().email()]).optional().transform((v) => v || null),
  lines: () => z.string().optional().transform((v) => (v ?? "").split("\n").map((l) => l.trim()).filter(Boolean)),
  ids: () => z.union([z.array(z.string()), z.string()]).optional().transform((v) => (v === undefined ? [] : Array.isArray(v) ? v.filter(Boolean) : v ? [v] : [])),
  json: <T extends z.ZodTypeAny>(item: T) => z.string().optional().transform((v, ctx) => {
    try {
      const parsed = z.array(item).safeParse(JSON.parse(v || "[]"));
      if (!parsed.success) {
        ctx.addIssue({ code: "custom", message: parsed.error.issues[0]?.message ?? "Invalid rows" });
        return z.NEVER;
      }
      return parsed.data as z.infer<T>[];
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid rows" });
      return z.NEVER;
    }
  }),
  enumOf: <T extends string>(values: readonly [T, ...T[]]) => z.enum(values),
  optEnum: <T extends string>(values: readonly [T, ...T[]]) => z.union([z.literal(""), z.enum(values)]).optional().transform((v) => (v ? (v as T) : null)),
  optId: () => z.string().max(40).optional().transform((v) => v || null),
  /** Local datetime-local value (club timezone) → UTC Date. */
  datetime: (tz: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Pick a date and time").transform((v) => zonedTimeToUtc(v.slice(0, 10), v.slice(11, 16), tz)),
  optDatetime: (tz: string) => z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)]).optional().transform((v) => (v ? zonedTimeToUtc(v.slice(0, 10), v.slice(11, 16), tz) : null)),
  optDate: () => z.union([z.literal(""), z.string().date()]).optional().transform((v) => (v ? new Date(`${v}T00:00:00Z`) : null)),
};

export function ensureSlug(value: string, fallback: string) {
  return slugify(value || fallback) || `item-${Date.now().toString(36)}`;
}

/** UTC Date → value for a datetime-local input in the club timezone. */
export function toLocalInput(date: Date | null | undefined, tz: string) {
  if (!date) return "";
  const p = zonedParts(date, tz);
  return `${dateKeyInZone(date, tz)}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function decimalString(value: { toString(): string } | null | undefined) {
  return value === null || value === undefined ? "" : value.toString();
}
