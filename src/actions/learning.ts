"use server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertUser } from "@/server/auth";
import { runAction, parseForm, UserError, type ActionResult } from "@/server/errors";
import { materialAccess, publishedMaterialWhere, setProgress } from "@/server/learning";
import { notify, emailNotifications } from "@/server/notifications";

const id = z.string().min(1).max(40);

export async function toggleBookmarkAction(materialId: string): Promise<ActionResult<{ bookmarked: boolean }>> {
  return runAction(async () => {
    const user = await assertUser();
    const mid = id.parse(materialId);
    const material = await prisma.learningMaterial.findFirst({ where: publishedMaterialWhere({ id: mid }) });
    if (!material) throw new UserError("Lesson not found.");
    const existing = await prisma.learningBookmark.findUnique({ where: { userId_materialId: { userId: user.id, materialId: mid } } });
    if (existing) await prisma.learningBookmark.delete({ where: { userId_materialId: { userId: user.id, materialId: mid } } });
    else await prisma.learningBookmark.create({ data: { userId: user.id, materialId: mid } });
    return { ok: true, message: existing ? "Removed from saved" : "Saved for later", data: { bookmarked: !existing } };
  });
}

export async function setProgressAction(materialId: string, status: "IN_PROGRESS" | "COMPLETED"): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    await setProgress(user.id, id.parse(materialId), z.enum(["IN_PROGRESS", "COMPLETED"]).parse(status));
    return { ok: true, message: status === "COMPLETED" ? "Lesson completed — nice work!" : "Lesson started" };
  });
}

export async function submitAssignmentAction(assignmentId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const { submission } = parseForm(z.object({ submission: z.string().trim().min(2, "Add your work or notes").max(20000) }), formData);
    const assignment = await prisma.learningAssignment.findFirst({ where: { id: id.parse(assignmentId), memberId: user.id }, include: { coach: true } });
    if (!assignment) throw new UserError("Assignment not found.");
    if (assignment.status === "CANCELLED" || assignment.status === "REVIEWED") throw new UserError("This assignment is closed.");
    await prisma.learningAssignment.update({ where: { id: assignment.id }, data: { submission, submittedAt: new Date(), status: "SUBMITTED" } });
    if (assignment.materialId) {
      const material = await prisma.learningMaterial.findUnique({ where: { id: assignment.materialId } });
      if (material && (await materialAccess(material, user)).canView) await setProgress(user.id, material.id, "COMPLETED").catch(() => null);
    }
    const n = await notify({ userId: assignment.coach.userId, type: "LEARNING_ASSIGNED", title: "Assignment submitted", body: `${user.name} submitted "${assignment.title}".`, link: "/coach/assignments" });
    await emailNotifications([n.id]);
    return { ok: true, message: "Submitted to your coach." };
  });
}
