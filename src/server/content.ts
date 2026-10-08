import "server-only";
import { cache } from "react";
import { prisma } from "@/server/db";
import { getAllSettings } from "@/server/settings";
import { dateKeyInZone, minutesOf, zonedParts } from "@/lib/time";

export type BlockItem = { title: string; body?: string };

export type Block = {
  key: string;
  eyebrow: string | null;
  title: string | null;
  highlight: string | null;
  body: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  secondaryLabel: string | null;
  secondaryHref: string | null;
  items: BlockItem[];
};

function toBlock(row: Awaited<ReturnType<typeof prisma.contentBlock.findMany>>[number]): Block {
  const items = Array.isArray(row.items) ? (row.items as unknown[]).filter((i): i is BlockItem => typeof i === "object" && i !== null && typeof (i as BlockItem).title === "string") : [];
  return { ...row, items };
}

/** Visible content blocks for a page, keyed by block key. */
export const getBlocks = cache(async (page: string) => {
  const rows = await prisma.contentBlock.findMany({ where: { page, visible: true }, orderBy: { position: "asc" } });
  return new Map(rows.map((r) => [r.key, toBlock(r)]));
});

export const primaryLocation = cache(async () =>
  prisma.location.findFirst({
    where: { active: true },
    orderBy: [{ isPrimary: "desc" }, { position: "asc" }],
    include: { openingHours: { orderBy: { weekday: "asc" } } },
  }),
);

/** Everything the public shell needs: settings, location, socials and live announcements. */
export const getSiteChrome = cache(async () => {
  const now = new Date();
  const [settings, location, socials, announcements] = await Promise.all([
    getAllSettings(),
    primaryLocation(),
    prisma.socialLink.findMany({ where: { visible: true }, orderBy: { position: "asc" } }),
    prisma.announcement.findMany({
      where: { published: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    }),
  ]);
  return { settings, location, socials, announcements };
});

export type OpenStatus = { open: boolean; label: string; detail: string | null };

/** Live open / closed state computed from the configured opening hours. */
export function openStatus(location: Awaited<ReturnType<typeof primaryLocation>>, now = new Date()): OpenStatus | null {
  if (!location || location.openingHours.length === 0) return null;
  const tz = location.timezone;
  const p = zonedParts(now, tz);
  const minutes = p.hour * 60 + p.minute;
  const today = location.openingHours.find((h) => h.weekday === p.weekday);
  if (location.openingDate && dateKeyInZone(location.openingDate, tz) > dateKeyInZone(now, tz)) {
    return { open: false, label: "Opening soon", detail: null };
  }
  if (today && !today.closed && minutes >= minutesOf(today.opensAt) && minutes < minutesOf(today.closesAt)) {
    return { open: true, label: "Open now", detail: `until ${today.closesAt}` };
  }
  for (let i = 0; i < 7; i++) {
    const day = (p.weekday + i) % 7;
    const h = location.openingHours.find((x) => x.weekday === day);
    if (!h || h.closed) continue;
    if (i === 0 && minutes >= minutesOf(h.opensAt)) continue;
    return { open: false, label: "Closed", detail: `opens ${i === 0 ? "today" : i === 1 ? "tomorrow" : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]} ${h.opensAt}` };
  }
  return { open: false, label: "Closed", detail: null };
}

export async function seoFor(path: string) {
  return prisma.seoEntry.findUnique({ where: { path } });
}
