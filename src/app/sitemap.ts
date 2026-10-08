import type { MetadataRoute } from "next";
import { prisma } from "@/server/db";
import { siteUrl } from "@/server/settings";
import { publishedMaterialWhere } from "@/server/learning";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await siteUrl();
  const noindex = new Set((await prisma.seoEntry.findMany({ where: { noindex: true }, select: { path: true } })).map((s) => s.path));
  const [plans, events, materials, coaches, puzzles, posts] = await Promise.all([
    prisma.membershipPlan.findMany({ where: { status: "ACTIVE" }, select: { slug: true, updatedAt: true } }),
    prisma.event.findMany({ where: { deletedAt: null, status: { in: ["PUBLISHED", "COMPLETED"] } }, select: { slug: true, updatedAt: true } }),
    prisma.learningMaterial.findMany({ where: publishedMaterialWhere(), select: { slug: true, updatedAt: true } }),
    prisma.coachProfile.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }),
    prisma.puzzle.findMany({ where: { published: true }, select: { id: true, updatedAt: true } }),
    prisma.communityPost.findMany({ where: { status: "VISIBLE" }, select: { id: true, updatedAt: true }, orderBy: { createdAt: "desc" }, take: 500 }),
  ]);
  const statics = ["/", "/memberships", "/coaches", "/book", "/events", "/learn", "/puzzles", "/community", "/gallery", "/about", "/contact", "/faq"];
  const entries: MetadataRoute.Sitemap = [
    ...statics.map((p) => ({ url: `${base}${p}`, changeFrequency: "weekly" as const, priority: p === "/" ? 1 : 0.8 })),
    ...plans.map((p) => ({ url: `${base}/join/${p.slug}`, lastModified: p.updatedAt })),
    ...events.map((e) => ({ url: `${base}/events/${e.slug}`, lastModified: e.updatedAt, priority: 0.7 })),
    ...materials.map((m) => ({ url: `${base}/learn/${m.slug}`, lastModified: m.updatedAt, priority: 0.6 })),
    ...coaches.map((c) => ({ url: `${base}/coaches/${c.slug}`, lastModified: c.updatedAt, priority: 0.6 })),
    ...puzzles.map((p) => ({ url: `${base}/puzzles/${p.id}`, lastModified: p.updatedAt, priority: 0.4 })),
    ...posts.map((p) => ({ url: `${base}/community/${p.id}`, lastModified: p.updatedAt, priority: 0.3 })),
  ];
  return entries.filter((e) => !noindex.has(e.url.replace(base, "") || "/"));
}
