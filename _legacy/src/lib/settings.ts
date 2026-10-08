import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { SETTING_DEFINITIONS } from "@/lib/settings-registry";

export type Settings = Record<string, unknown>;

export const getSettings = cache(async (): Promise<Settings> => {
  try {
    const rows = await prisma.siteSetting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    return {};
  }
});

export function settingText(settings: Settings, key: string, fallback = "") {
  const value = settings[key];
  if (typeof value === "string" && value.trim()) return value;
  const def = SETTING_DEFINITIONS[key]?.default;
  return typeof def === "string" ? def : fallback;
}

export function settingNumber(settings: Settings, key: string, fallback = 0) {
  const value = settings[key];
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (Number.isFinite(parsed)) return parsed;
  const def = SETTING_DEFINITIONS[key]?.default;
  return typeof def === "number" ? def : fallback;
}

export function settingBool(settings: Settings, key: string, fallback = false) {
  const value = settings[key];
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  const def = SETTING_DEFINITIONS[key]?.default;
  return typeof def === "boolean" ? def : fallback;
}

/** Absolute public URL for links in emails, SMS, sitemap and canonical tags. */
export function siteUrl(settings: Settings) {
  const fromSettings = settingText(settings, "site.url");
  const base = fromSettings || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return base.replace(/\/+$/, "");
}
