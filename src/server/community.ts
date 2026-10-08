import "server-only";
import { prisma } from "@/server/db";
import { UserError } from "@/server/errors";
import { getSettings } from "@/server/settings";
import { hasActiveMembership } from "@/server/memberships";
import { rateLimit } from "@/server/rate-limit";

export async function assertCanParticipate(user: { id: string; role: string }, action: "post" | "comment") {
  const settings = await getSettings("community");
  if (!settings.enabled) throw new UserError("The community is currently closed.");
  if (action === "post" && settings.requireMembershipToPost && user.role === "MEMBER" && !(await hasActiveMembership(user.id))) {
    throw new UserError("Posting is open to members with an active membership.");
  }
  const limit = action === "post" ? [5, 3600] : [30, 3600];
  if (!(await rateLimit(`community:${action}:${user.id}`, limit[0], limit[1]))) throw new UserError("You're posting very quickly. Please wait a little.");
}

/** Recomputes cached counters from source rows so they never drift. */
export async function refreshPostCounters(postId: string) {
  const [likes, comments] = await Promise.all([
    prisma.communityLike.count({ where: { postId } }),
    prisma.communityComment.count({ where: { postId, status: "VISIBLE" } }),
  ]);
  await prisma.communityPost.update({ where: { id: postId }, data: { likeCount: likes, commentCount: comments } });
  return { likes, comments };
}
