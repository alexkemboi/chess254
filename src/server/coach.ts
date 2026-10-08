import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { assertUser, requireUser } from "@/server/auth";
import { can } from "@/server/rbac";
import { UserError } from "@/server/errors";

/** Coach workspace guard for pages: needs the permission AND a coach profile. */
export async function requireCoach() {
  const user = await requireUser("/coach");
  const coach = await prisma.coachProfile.findUnique({ where: { userId: user.id } });
  if (!coach || (!(await can(user.role, "coach.portal")) && !(await can(user.role, "coaches.manage")))) redirect("/forbidden");
  return { user, coach };
}

/** Same guard for Server Actions. */
export async function assertCoach() {
  const user = await assertUser();
  const coach = await prisma.coachProfile.findUnique({ where: { userId: user.id } });
  if (!coach || (!(await can(user.role, "coach.portal")) && !(await can(user.role, "coaches.manage")))) throw new UserError("Coach access required.");
  return { user, coach };
}

/** Members a coach works with: explicitly assigned, or who have booked them. */
export async function coachMemberIds(coachId: string) {
  const [linked, booked] = await Promise.all([
    prisma.coachMember.findMany({ where: { coachId }, select: { memberId: true } }),
    prisma.booking.findMany({ where: { coachId, status: { in: ["CONFIRMED", "COMPLETED", "NO_SHOW"] } }, distinct: ["memberId"], select: { memberId: true } }),
  ]);
  return [...new Set([...linked.map((l) => l.memberId), ...booked.map((b) => b.memberId)])];
}
