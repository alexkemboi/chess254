import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { UserError } from "@/server/errors";
import { hasActiveMembership } from "@/server/memberships";

export type MaterialAccessResult = { canView: boolean; canDownload: boolean; reason: string | null };

/** Members-only materials require an active membership whose plan includes learning; staff always see everything. */
export async function materialAccess(
  material: { access: "PUBLIC" | "MEMBERS"; downloadable: boolean },
  user: { id: string; role: string } | null,
): Promise<MaterialAccessResult> {
  const staff = user && user.role !== "MEMBER";
  if (material.access === "PUBLIC") return { canView: true, canDownload: material.downloadable && Boolean(user), reason: material.downloadable && !user ? "Sign in to download" : null };
  if (!user) return { canView: false, canDownload: false, reason: "Sign in with an active membership to open this lesson." };
  if (staff) return { canView: true, canDownload: material.downloadable, reason: null };
  const learning = await prisma.membership.count({
    where: { userId: user.id, status: "ACTIVE", startsAt: { lte: new Date() }, expiresAt: { gt: new Date() }, plan: { learningAccess: true } },
  });
  if (!learning) {
    const anyMembership = await hasActiveMembership(user.id);
    return { canView: false, canDownload: false, reason: anyMembership ? "Your current plan does not include academy materials." : "This lesson is for members with academy access." };
  }
  return { canView: true, canDownload: material.downloadable, reason: null };
}

export function publishedMaterialWhere(extra: Prisma.LearningMaterialWhereInput = {}): Prisma.LearningMaterialWhereInput {
  return { published: true, deletedAt: null, category: { visible: true }, ...extra };
}

export async function setProgress(userId: string, materialId: string, status: "IN_PROGRESS" | "COMPLETED") {
  const material = await prisma.learningMaterial.findFirst({ where: publishedMaterialWhere({ id: materialId }) });
  if (!material) throw new UserError("Lesson not found.");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, role: true } });
  const access = await materialAccess(material, user);
  if (!access.canView) throw new UserError(access.reason ?? "You do not have access to this lesson.");
  const completedAt = status === "COMPLETED" ? new Date() : null;
  return prisma.learningProgress.upsert({
    where: { userId_materialId: { userId, materialId } },
    create: { userId, materialId, status, completedAt },
    update: status === "COMPLETED" ? { status, completedAt } : {},
  });
}

export async function learningSummary(userId: string) {
  const [completed, inProgress, bookmarks, total] = await Promise.all([
    prisma.learningProgress.count({ where: { userId, status: "COMPLETED" } }),
    prisma.learningProgress.count({ where: { userId, status: "IN_PROGRESS" } }),
    prisma.learningBookmark.count({ where: { userId } }),
    prisma.learningMaterial.count({ where: publishedMaterialWhere() }),
  ]);
  return { completed, inProgress, bookmarks, total };
}
