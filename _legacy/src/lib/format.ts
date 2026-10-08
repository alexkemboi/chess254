/** Client-safe formatting helpers. All money in this app is whole currency units. */

type DecimalLike = { toString(): string } | number | string | null | undefined;

export const toNumber = (value: DecimalLike) => (value === null || value === undefined ? 0 : Number(value.toString()));

export function money(value: DecimalLike, currency = "KES") {
  const amount = toNumber(value);
  try {
    return new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString("en-KE")}`;
  }
}

export const TIMEZONE = "Africa/Nairobi";

export function formatDate(date: Date | string | null | undefined, style: "short" | "medium" | "long" | "full" = "medium") {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-KE", { dateStyle: style, timeZone: TIMEZONE }).format(new Date(date));
}

export function formatDateTime(date: Date | string | null | undefined) {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE }).format(new Date(date));
}

export function formatTime(date: Date | string | null | undefined) {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-KE", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE }).format(new Date(date));
}

export function monthShort(date: Date) {
  return new Intl.DateTimeFormat("en-KE", { month: "short", timeZone: TIMEZONE }).format(date).toUpperCase();
}

export function dayNumber(date: Date) {
  return new Intl.DateTimeFormat("en-KE", { day: "2-digit", timeZone: TIMEZONE }).format(date);
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}

export const humanize = (value: string) => value.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** Normalises Kenyan mobile numbers to 2547XXXXXXXX / 2541XXXXXXXX. Returns null when invalid. */
export function normalizeKenyanPhone(input: string | null | undefined) {
  if (!input) return null;
  const digits = input.replace(/[^\d+]/g, "").replace(/^\+/, "");
  let national: string;
  if (/^254[17]\d{8}$/.test(digits)) national = digits.slice(3);
  else if (/^0[17]\d{8}$/.test(digits)) national = digits.slice(1);
  else if (/^[17]\d{8}$/.test(digits)) national = digits;
  else return null;
  return `254${national}`;
}

export const displayPhone = (msisdn: string | null | undefined) => (msisdn && /^254\d{9}$/.test(msisdn) ? `+254 ${msisdn.slice(3, 6)} ${msisdn.slice(6, 9)} ${msisdn.slice(9)}` : msisdn ?? "");
