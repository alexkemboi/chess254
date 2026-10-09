import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle, MessagesSquare, Pin, PenSquare } from "lucide-react";
import type { PostKind, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { currentUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { seoFor } from "@/server/content";
import { Container, PageHero } from "@/components/site/cards";
import { EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LikeButton } from "@/components/site/community-ui";
import { humanize, relativeTime } from "@/lib/format";
import { cn, initials, plainText, truncate } from "@/lib/utils";

const KINDS: PostKind[] = ["DISCUSSION", "QUESTION", "GAME", "ACHIEVEMENT", "TOURNAMENT"];
const PAGE = 20;

export async function generateMetadata(): Promise<Metadata> {
  const seo = await seoFor("/community");
  return { title: seo?.title ?? "Community", description: seo?.description ?? "Discuss games, ask questions and share achievements with fellow players.", alternates: { canonical: "/community" } };
}

export default async function CommunityPage({ searchParams }: { searchParams: Promise<{ kind?: string; q?: string; sort?: string; page?: string; following?: string }> }) {
  const sp = await searchParams;
  const [user, settings] = await Promise.all([currentUser(), getSettings("community")]);
  const kind = KINDS.includes(sp.kind as PostKind) ? (sp.kind as PostKind) : undefined;
  const q = sp.q?.trim().slice(0, 80);
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.CommunityPostWhereInput = {
    status: "VISIBLE",
    author: { suspendedAt: null },
    ...(kind ? { kind } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }] } : {}),
    ...(sp.following && user ? { follows: { some: { userId: user.id } } } : {}),
  };
  const orderBy: Prisma.CommunityPostOrderByWithRelationInput[] = sp.sort === "top" ? [{ pinned: "desc" }, { likeCount: "desc" }, { createdAt: "desc" }] : [{ pinned: "desc" }, { createdAt: "desc" }];
  const [posts, total] = await Promise.all([
    prisma.communityPost.findMany({ where, orderBy, skip: (page - 1) * PAGE, take: PAGE, include: { author: { select: { name: true } }, likes: user ? { where: { userId: user.id }, select: { userId: true } } : false } }),
    prisma.communityPost.count({ where }),
  ]);
  const link = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams(Object.entries({ kind, q, sort: sp.sort, following: sp.following, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/community${params.size ? `?${params}` : ""}`;
  };
  const chip = (active: boolean) => cn("whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition", active ? "border-brand bg-brand text-brand-foreground" : "border-border text-muted hover:text-foreground");

  if (!settings.enabled) {
    return <Container className="py-24"><EmptyState icon={<MessagesSquare />} title="The community is closed right now" description="Check back soon." /></Container>;
  }

  return (
    <>
      <PageHero glyph="♛" eyebrow="Community" title="Find your" highlight="people." body="Talk games, ask questions, share your wins and plan your next tournament.">
        <Button asChild size="lg"><Link href={user ? "/community/new" : "/login?next=/community/new"}><PenSquare />Start a post</Link></Button>
      </PageHero>
      <Container className="max-w-4xl py-12">
        <div className="mb-6 flex flex-col gap-4">
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            <Link href={link({ kind: undefined, page: undefined })} className={chip(!kind)}>Everything</Link>
            {KINDS.map((k) => <Link key={k} href={link({ kind: k, page: undefined })} className={chip(kind === k)}>{humanize(k)}</Link>)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={link({ sort: undefined, page: undefined })} className={chip(sp.sort !== "top")}>Latest</Link>
            <Link href={link({ sort: "top", page: undefined })} className={chip(sp.sort === "top")}>Top</Link>
            {user && <Link href={link({ following: sp.following ? undefined : "1", page: undefined })} className={chip(Boolean(sp.following))}>Following</Link>}
            <form role="search" className="ml-auto w-full sm:w-64">
              {kind && <input type="hidden" name="kind" value={kind} />}
              <input name="q" defaultValue={q} placeholder="Search discussions…" className="h-10 w-full rounded-full border border-border bg-surface px-5 text-sm outline-none focus:border-brand" />
            </form>
          </div>
        </div>
        {posts.length ? (
          <ul className="grid gap-3">
            {posts.map((p) => (
              <li key={p.id} className="group min-w-0 rounded-3xl border border-border bg-surface p-5 transition hover:border-border-strong sm:p-6">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                  <span className="grid size-9 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand-ink">{initials(p.author.name)}</span>
                  <span className="min-w-0 truncate font-semibold">{p.author.name}</span>
                  <span className="text-muted">· {relativeTime(p.createdAt)}</span>
                  <span className="ml-auto flex gap-1.5">
                    {p.pinned && <Badge variant="solid"><Pin className="size-3" />Pinned</Badge>}
                    <Badge variant="neutral">{humanize(p.kind)}</Badge>
                  </span>
                </div>
                <Link href={`/community/${p.id}`} className="mt-3 block">
                  <h2 className="font-display text-xl font-bold tracking-tight group-hover:text-brand-ink">{p.title}</h2>
                  <p className="mt-1.5 line-clamp-2 text-muted">{truncate(plainText(p.body), 240)}</p>
                </Link>
                <div className="mt-4 flex items-center gap-2">
                  <LikeButton postId={p.id} liked={Array.isArray(p.likes) && p.likes.length > 0} count={p.likeCount} signedIn={Boolean(user)} />
                  <Link href={`/community/${p.id}#comments`} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted hover:bg-foreground/5 hover:text-foreground"><MessageCircle className="size-4" />{p.commentCount}</Link>
                  {p.pgn && <Badge className="ml-auto">♞ Game attached</Badge>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<MessagesSquare />} title={q || kind || sp.following ? "Nothing matches" : "No posts yet"} description={q || kind ? "Try a different filter." : "Be the first to start a conversation."} action={<Button asChild><Link href={user ? "/community/new" : "/login?next=/community/new"}>Start a post</Link></Button>} />
        )}
        {total > PAGE && (
          <div className="mt-8 flex items-center justify-center gap-2">
            {page > 1 && <Button asChild variant="secondary"><Link href={link({ page: String(page - 1) })}>Newer</Link></Button>}
            <span className="text-sm text-muted">Page {page} of {Math.ceil(total / PAGE)}</span>
            {page * PAGE < total && <Button asChild variant="secondary"><Link href={link({ page: String(page + 1) })}>Older</Link></Button>}
          </div>
        )}
      </Container>
    </>
  );
}
