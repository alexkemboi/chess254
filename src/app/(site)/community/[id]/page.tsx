import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { prisma } from "@/server/db";
import { currentUser } from "@/server/auth";
import { can } from "@/server/rbac";
import { Container } from "@/components/site/cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PgnViewer } from "@/components/chess/pgn-viewer";
import { CommentForm, DeleteCommentButton, DeletePostButton, FollowButton, LikeButton, ReportButton, ShareButton } from "@/components/site/community-ui";
import { humanize, relativeTime } from "@/lib/format";
import { initials, plainText, truncate } from "@/lib/utils";

async function load(id: string) {
  return prisma.communityPost.findFirst({ where: { id, status: "VISIBLE" }, include: { author: { select: { id: true, name: true } } } });
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const post = await load((await params).id);
  return post ? { title: post.title, description: truncate(plainText(post.body), 160), alternates: { canonical: `/community/${post.id}` } } : { title: "Post not found" };
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const post = await load((await params).id);
  if (!post) notFound();
  const user = await currentUser();
  const [comments, liked, following, moderator] = await Promise.all([
    prisma.communityComment.findMany({ where: { postId: post.id, status: "VISIBLE" }, orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, name: true } } } }),
    user ? prisma.communityLike.findUnique({ where: { postId_userId: { postId: post.id, userId: user.id } } }) : null,
    user ? prisma.communityFollow.findUnique({ where: { postId_userId: { postId: post.id, userId: user.id } } }) : null,
    user ? can(user.role, "community.moderate") : false,
  ]);
  return (
    <Container className="max-w-3xl py-12 sm:py-16">
      <Link href="/community" className="text-sm text-muted hover:text-foreground">← Community</Link>
      <article className="mt-6">
        <div className="flex items-center gap-3 text-sm">
          <span className="grid size-10 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand">{initials(post.author.name)}</span>
          <div><div className="font-semibold">{post.author.name}</div><div className="text-xs text-muted">{relativeTime(post.createdAt)}</div></div>
          <Badge variant="neutral" className="ml-auto">{humanize(post.kind)}</Badge>
        </div>
        <h1 className="display mt-6 text-[clamp(2rem,5vw,3.4rem)]">{post.title}</h1>
        <div className="prose-chess mt-6"><ReactMarkdown remarkPlugins={[remarkGfm]}>{post.body}</ReactMarkdown></div>
        {post.pgn && <div className="mt-8"><PgnViewer pgn={post.pgn} /></div>}
        <div className="mt-8 flex flex-wrap items-center gap-1 border-y border-border py-3">
          <LikeButton postId={post.id} liked={Boolean(liked)} count={post.likeCount} signedIn={Boolean(user)} />
          {user && <FollowButton postId={post.id} following={Boolean(following)} />}
          <ShareButton title={post.title} />
          <span className="ml-auto flex">
            {user && user.id !== post.author.id && <ReportButton postId={post.id} />}
            {user && (user.id === post.author.id || moderator) && <DeletePostButton postId={post.id} />}
          </span>
        </div>
      </article>
      <section id="comments" className="mt-10">
        <h2 className="font-display text-2xl font-bold tracking-tight">{comments.length} {comments.length === 1 ? "reply" : "replies"}</h2>
        <ul className="mt-6 grid gap-4">
          {comments.map((c) => (
            <li key={c.id} className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-center gap-2 text-sm">
                <span className="grid size-8 place-items-center rounded-full bg-surface-3 text-[11px] font-bold">{initials(c.author.name)}</span>
                <span className="font-semibold">{c.author.name}</span>
                <span className="text-muted">· {relativeTime(c.createdAt)}</span>
                <span className="ml-auto flex items-center gap-2">
                  {user && user.id !== c.author.id && <ReportButton commentId={c.id} />}
                  {user && (user.id === c.author.id || moderator) && <DeleteCommentButton commentId={c.id} />}
                </span>
              </div>
              <div className="prose-chess mt-2 text-[15px]"><ReactMarkdown>{c.body}</ReactMarkdown></div>
            </li>
          ))}
        </ul>
        <div className="mt-6">
          {user ? <CommentForm postId={post.id} /> : <Button asChild variant="secondary"><Link href={`/login?next=/community/${post.id}`}>Sign in to reply</Link></Button>}
        </div>
      </section>
    </Container>
  );
}
