"use server";
import { z } from "zod";
import { Chess } from "chess.js";
import { prisma } from "@/server/db";
import { assertUser } from "@/server/auth";
import { can } from "@/server/rbac";
import { runAction, parseForm, UserError, type ActionResult } from "@/server/errors";
import { assertCanParticipate, refreshPostCounters } from "@/server/community";
import { notify, emailNotifications } from "@/server/notifications";
import { rateLimit } from "@/server/rate-limit";

const id = z.string().min(1).max(40);

function validPgn(pgn: string) {
  try {
    new Chess().loadPgn(pgn);
    return true;
  } catch {
    return false;
  }
}

export async function createPostAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    await assertCanParticipate(user, "post");
    const data = parseForm(
      z.object({
        kind: z.enum(["DISCUSSION", "QUESTION", "GAME", "ACHIEVEMENT", "TOURNAMENT"]),
        title: z.string().trim().min(4, "Give your post a title").max(140),
        body: z.string().trim().min(2, "Write something").max(10000),
        pgn: z.string().trim().max(20000).optional().transform((v) => v || null),
      }),
      formData,
    );
    if (data.pgn && !validPgn(data.pgn)) throw new UserError("That PGN couldn't be read.", { pgn: "Paste a valid PGN" });
    if (data.kind === "GAME" && !data.pgn) throw new UserError("Add the game's PGN.", { pgn: "Required for shared games" });
    const post = await prisma.communityPost.create({ data: { ...data, authorId: user.id, follows: { create: { userId: user.id } } } });
    return { ok: true, message: "Posted!", redirect: `/community/${post.id}` };
  });
}

export async function commentAction(postId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    await assertCanParticipate(user, "comment");
    const { body } = parseForm(z.object({ body: z.string().trim().min(1, "Write a comment").max(4000) }), formData);
    const post = await prisma.communityPost.findFirst({ where: { id: id.parse(postId), status: "VISIBLE" }, include: { follows: true } });
    if (!post) throw new UserError("This post is no longer available.");
    await prisma.communityComment.create({ data: { postId: post.id, authorId: user.id, body } });
    await prisma.communityFollow.upsert({ where: { postId_userId: { postId: post.id, userId: user.id } }, create: { postId: post.id, userId: user.id }, update: {} });
    await refreshPostCounters(post.id);
    const ids: string[] = [];
    for (const f of post.follows) {
      if (f.userId === user.id) continue;
      ids.push((await notify({ userId: f.userId, type: "COMMUNITY_REPLY", title: "New reply", body: `${user.name} replied to "${post.title}".`, link: `/community/${post.id}` })).id);
    }
    await emailNotifications(ids.slice(0, 25));
    return { ok: true, message: "Comment posted." };
  });
}

export async function toggleLikeAction(postId: string): Promise<ActionResult<{ liked: boolean; likes: number }>> {
  return runAction(async () => {
    const user = await assertUser();
    if (!(await rateLimit(`like:${user.id}`, 120, 600))) throw new UserError("Slow down a little.");
    const pid = id.parse(postId);
    const post = await prisma.communityPost.findFirst({ where: { id: pid, status: "VISIBLE" } });
    if (!post) throw new UserError("Post not found.");
    const existing = await prisma.communityLike.findUnique({ where: { postId_userId: { postId: pid, userId: user.id } } });
    if (existing) await prisma.communityLike.delete({ where: { postId_userId: { postId: pid, userId: user.id } } });
    else await prisma.communityLike.create({ data: { postId: pid, userId: user.id } });
    const { likes } = await refreshPostCounters(pid);
    return { ok: true, data: { liked: !existing, likes } };
  });
}

export async function toggleFollowAction(postId: string): Promise<ActionResult<{ following: boolean }>> {
  return runAction(async () => {
    const user = await assertUser();
    const pid = id.parse(postId);
    const existing = await prisma.communityFollow.findUnique({ where: { postId_userId: { postId: pid, userId: user.id } } });
    if (existing) await prisma.communityFollow.delete({ where: { postId_userId: { postId: pid, userId: user.id } } });
    else {
      if (!(await prisma.communityPost.findFirst({ where: { id: pid, status: "VISIBLE" } }))) throw new UserError("Post not found.");
      await prisma.communityFollow.create({ data: { postId: pid, userId: user.id } });
    }
    return { ok: true, message: existing ? "Unfollowed" : "Following — you'll be notified of replies", data: { following: !existing } };
  });
}

export async function reportAction(target: { postId?: string; commentId?: string }, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    if (!(await rateLimit(`report:${user.id}`, 10, 3600))) throw new UserError("You've sent a lot of reports. Please wait.");
    const { reason } = parseForm(z.object({ reason: z.string().trim().min(3, "Tell us what's wrong").max(500) }), formData);
    if (!target.postId && !target.commentId) throw new UserError("Nothing to report.");
    await prisma.communityReport.create({ data: { reporterId: user.id, postId: target.postId ? id.parse(target.postId) : null, commentId: target.commentId ? id.parse(target.commentId) : null, reason } });
    return { ok: true, message: "Thanks — a moderator will review it." };
  });
}

/** Authors can remove their own content; moderators can remove anything (audited in admin actions). */
export async function deleteOwnPostAction(postId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const post = await prisma.communityPost.findUnique({ where: { id: id.parse(postId) } });
    if (!post) throw new UserError("Post not found.");
    if (post.authorId !== user.id && !(await can(user.role, "community.moderate"))) throw new UserError("You can only delete your own posts.");
    await prisma.communityPost.update({ where: { id: post.id }, data: { status: "REMOVED", moderatedById: post.authorId === user.id ? null : user.id, moderatedAt: new Date() } });
    return { ok: true, message: "Post removed.", redirect: "/community" };
  });
}

export async function deleteOwnCommentAction(commentId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const comment = await prisma.communityComment.findUnique({ where: { id: id.parse(commentId) } });
    if (!comment) throw new UserError("Comment not found.");
    if (comment.authorId !== user.id && !(await can(user.role, "community.moderate"))) throw new UserError("You can only delete your own comments.");
    await prisma.communityComment.update({ where: { id: comment.id }, data: { status: "REMOVED" } });
    await refreshPostCounters(comment.postId);
    return { ok: true, message: "Comment removed." };
  });
}
