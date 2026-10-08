import { prisma } from "@/lib/prisma";

export async function getHomeContent() {
  try {
    const [plans, events, photos, announcement, settings] = await Promise.all([
      prisma.membershipPlan.findMany({ where: { status: "ACTIVE" }, include: { features: { orderBy: { position: "asc" } } }, orderBy: { priority: "asc" } }),
      prisma.event.findMany({ where: { status: "PUBLISHED", startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" }, take: 3 }),
      prisma.galleryImage.findMany({ where: { visible: true }, orderBy: [{ featured: "desc" }, { position: "asc" }], take: 6 }),
      prisma.announcement.findFirst({ where: { published: true, OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }], AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] }] }, orderBy: { createdAt: "desc" } }),
      prisma.siteSetting.findMany({ where: { key: { in: ["club.name", "club.location", "club.tagline", "club.contactEmail", "home.heroBody"] } } }),
    ]);
    return { plans, events, photos, announcement, settings: Object.fromEntries(settings.map((s) => [s.key, s.value])) as Record<string, unknown>, databaseReady: true };
  } catch {
    return { plans: [], events: [], photos: [], announcement: null, settings: {}, databaseReady: false };
  }
}

export function settingText(settings: Record<string, unknown>, key: string, fallback: string) {
  const value = settings[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}
