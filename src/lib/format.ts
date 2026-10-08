/** Display formatting shared by server and client components. */

type Numeric = number | string | { toString(): string };

const CURRENCY_LABELS: Record<string, string> = { KES: "KSh" };

export function toNumber(value: Numeric | null | undefined) {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(n) ? n : 0;
}

export function formatMoney(amount: Numeric, currency: string) {
  const n = toNumber(amount);
  const label = CURRENCY_LABELS[currency] ?? currency;
  const digits = Number.isInteger(n) ? 0 : 2;
  return `${label} ${n.toLocaleString("en-KE", { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
}

export function formatNumber(value: number) {
  return value.toLocaleString("en-KE");
}

export const BILLING_PERIOD_LABELS: Record<string, { short: string; long: string }> = {
  DAILY: { short: "day", long: "Daily" },
  WEEKLY: { short: "week", long: "Weekly" },
  MONTHLY: { short: "month", long: "Monthly" },
  QUARTERLY: { short: "quarter", long: "Quarterly" },
  ANNUAL: { short: "year", long: "Annual" },
};

export function humanize(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word, i) => (i === 0 ? word[0]?.toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export function formatDate(date: Date | string, timeZone: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-KE", { ...opts, timeZone }).format(new Date(date));
}

export function formatTime(date: Date | string, timeZone: string) {
  return new Intl.DateTimeFormat("en-KE", { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).format(new Date(date)).replace(" ", " ").toUpperCase();
}

export function formatDateTime(date: Date | string, timeZone: string) {
  return `${formatDate(date, timeZone, { weekday: "short", day: "numeric", month: "short", year: "numeric" })} · ${formatTime(date, timeZone)}`;
}

/** "16:00" → "4:00 PM" */
export function formatClock(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function relativeTime(date: Date | string, now = new Date()) {
  const diff = (new Date(date).getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), "month");
  return rtf.format(Math.round(diff / (86400 * 365)), "year");
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
