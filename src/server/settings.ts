import "server-only";
import { cache } from "react";
import { z } from "zod";
import { prisma } from "@/server/db";

/**
 * Typed settings. Each group is one SiteSetting row whose JSON value is
 * validated by its schema. The values themselves are seeded into and edited in
 * PostgreSQL; schema defaults are neutral system fallbacks used only when a
 * group has never been saved (e.g. an empty database).
 */
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour such as #019C98");
const optionalUrl = z.union([z.literal(""), z.string().url()]).default("");
const optionalEmail = z.union([z.literal(""), z.string().email()]).default("");
const bool = (fallback: boolean) => z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean()).default(fallback);

export const SETTINGS_SCHEMAS = {
  general: z.object({
    siteName: z.string().min(1).default("Clubhouse"),
    tagline: z.string().default(""),
    siteUrl: optionalUrl,
    timezone: z.string().default("UTC"),
    currency: z.string().length(3).default("KES"),
  }),
  brand: z.object({
    logoText: z.string().default(""),
    logoAccent: z.string().default(""),
    primaryColor: hex.default("#019C98"),
    heroImage: z.string().default(""),
    ogImage: z.string().default(""),
  }),
  contact: z.object({
    email: optionalEmail,
    phone: z.string().default(""),
    whatsapp: z.string().default(""),
    contactIntro: z.string().default(""),
  }),
  booking: z.object({
    slotIntervalMinutes: z.coerce.number().int().min(5).max(240).default(30),
    minNoticeHours: z.coerce.number().int().min(0).max(720).default(2),
    maxAdvanceDays: z.coerce.number().int().min(1).max(365).default(30),
    cancellationHours: z.coerce.number().int().min(0).max(720).default(12),
    holdMinutes: z.coerce.number().int().min(5).max(120).default(15),
    maxActiveBookingsPerMember: z.coerce.number().int().min(1).max(100).default(10),
    cancellationPolicy: z.string().default(""),
  }),
  membership: z.object({
    renewalReminderDays: z.coerce.number().int().min(0).max(60).default(5),
    allowEarlyRenewal: bool(true),
    joinIntro: z.string().default(""),
  }),
  payments: z.object({
    taxRatePercent: z.coerce.number().min(0).max(100).default(0),
    taxInclusive: bool(true),
    taxLabel: z.string().default("VAT"),
    orderExpiryMinutes: z.coerce.number().int().min(5).max(1440).default(30),
    invoicePrefix: z.string().min(1).max(8).default("INV"),
    invoiceFooter: z.string().default(""),
  }),
  notifications: z.object({
    emailEnabled: bool(true),
    smsEnabled: bool(false),
    bookingReminderHours: z.coerce.number().int().min(1).max(72).default(24),
    adminAlertEmail: optionalEmail,
  }),
  email: z.object({
    fromName: z.string().default(""),
    fromEmail: optionalEmail,
    replyTo: optionalEmail,
  }),
  seo: z.object({
    defaultTitle: z.string().default(""),
    titleTemplate: z.string().default("%s"),
    defaultDescription: z.string().default(""),
    keywords: z.string().default(""),
    twitterHandle: z.string().default(""),
  }),
  events: z.object({
    cancellationHours: z.coerce.number().int().min(0).max(720).default(24),
    showPastEvents: bool(true),
  }),
  community: z.object({
    enabled: bool(true),
    requireMembershipToPost: bool(false),
    guidelines: z.string().default(""),
  }),
} as const;

export type SettingsGroup = keyof typeof SETTINGS_SCHEMAS;
export type SettingsOf<G extends SettingsGroup> = z.infer<(typeof SETTINGS_SCHEMAS)[G]>;
export type AllSettings = { [G in SettingsGroup]: SettingsOf<G> };

export const SETTINGS_GROUPS = Object.keys(SETTINGS_SCHEMAS) as SettingsGroup[];

/** Every settings group, parsed and typed, loaded once per request. */
export const getAllSettings = cache(async (): Promise<AllSettings> => {
  const rows = await prisma.siteSetting.findMany({ where: { key: { in: SETTINGS_GROUPS } } }).catch(() => []);
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<SettingsGroup, unknown>;
  for (const group of SETTINGS_GROUPS) {
    const parsed = SETTINGS_SCHEMAS[group].safeParse(byKey.get(group) ?? {});
    out[group] = parsed.success ? parsed.data : SETTINGS_SCHEMAS[group].parse({});
  }
  return out as AllSettings;
});

export async function getSettings<G extends SettingsGroup>(group: G): Promise<SettingsOf<G>> {
  return (await getAllSettings())[group];
}

export async function saveSettings<G extends SettingsGroup>(group: G, value: unknown) {
  const parsed = SETTINGS_SCHEMAS[group].parse(value);
  await prisma.siteSetting.upsert({ where: { key: group }, create: { key: group, value: parsed }, update: { value: parsed } });
  return parsed as SettingsOf<G>;
}

export async function siteUrl() {
  const { siteUrl } = await getSettings("general");
  return (siteUrl || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}
