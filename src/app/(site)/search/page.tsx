import Link from "next/link";
import { Search } from "lucide-react";
import { prisma } from "@/server/db";
import { publishedMaterialWhere } from "@/server/learning";
import { getSettings } from "@/server/settings";
import { Container } from "@/components/site/cards";
import { EmptyState } from "@/components/ui/misc";
import { formatDate, humanize } from "@/lib/format";

export const metadata = { title: "Search", robots: { index: false } };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q?.trim().slice(0, 80) ?? "";
  const { timezone } = await getSettings("general");
  const term = { contains: q, mode: "insensitive" as const };
  const results = q.length >= 2
    ? await Promise.all([
        prisma.learningMaterial.findMany({ where: publishedMaterialWhere({ OR: [{ title: term }, { summary: term }] }), take: 6, select: { slug: true, title: true, type: true } }),
        prisma.event.findMany({ where: { deletedAt: null, status: { in: ["PUBLISHED", "COMPLETED"] }, OR: [{ title: term }, { description: term }] }, take: 6, orderBy: { startsAt: "desc" }, select: { slug: true, title: true, startsAt: true } }),
        prisma.communityPost.findMany({ where: { status: "VISIBLE", OR: [{ title: term }, { body: term }] }, take: 6, orderBy: { createdAt: "desc" }, select: { id: true, title: true, kind: true } }),
        prisma.coachProfile.findMany({ where: { isActive: true, OR: [{ user: { name: term } }, { headline: term }] }, take: 6, select: { slug: true, headline: true, user: { select: { name: true } } } }),
        prisma.galleryImage.findMany({ where: { visible: true, deletedAt: null, OR: [{ title: term }, { caption: term }] }, take: 6, select: { id: true, title: true } }),
        prisma.puzzle.findMany({ where: { published: true, OR: [{ title: term }, { theme: term }] }, take: 6, select: { id: true, title: true, rating: true } }),
      ])
    : null;
  const groups = results
    ? [
        { title: "Lessons", items: results[0].map((m) => ({ href: `/learn/${m.slug}`, label: m.title, meta: humanize(m.type) })) },
        { title: "Events", items: results[1].map((e) => ({ href: `/events/${e.slug}`, label: e.title, meta: formatDate(e.startsAt, timezone) })) },
        { title: "Community", items: results[2].map((p) => ({ href: `/community/${p.id}`, label: p.title, meta: humanize(p.kind) })) },
        { title: "Coaches", items: results[3].map((c) => ({ href: `/coaches/${c.slug}`, label: c.user.name, meta: c.headline ?? "" })) },
        { title: "Puzzles", items: results[5].map((p) => ({ href: `/puzzles/${p.id}`, label: p.title, meta: `Rating ${p.rating}` })) },
        { title: "Gallery", items: results[4].map((g) => ({ href: `/gallery?q=${encodeURIComponent(g.title)}`, label: g.title, meta: "Photo" })) },
      ].filter((g) => g.items.length)
    : [];
  return (
    <Container className="max-w-3xl py-12 sm:py-16">
      <h1 className="display text-5xl">Search.</h1>
      <form role="search" className="mt-8">
        <div className="relative">
          <Search className="absolute left-5 top-1/2 size-5 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={q} autoFocus placeholder="Lessons, events, coaches, puzzles, posts…" className="h-14 w-full rounded-full border border-border bg-surface pl-14 pr-5 text-lg outline-none focus:border-brand" />
        </div>
      </form>
      <div className="mt-10 grid gap-8">
        {q.length >= 2 && groups.length === 0 && <EmptyState icon={<Search />} title={`No results for “${q}”`} description="Try a shorter or different search." />}
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="eyebrow mb-3">{g.title}</h2>
            <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
              {g.items.map((i) => (
                <li key={i.href}><Link href={i.href} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-foreground/[0.03]"><span className="font-medium">{i.label}</span><span className="truncate text-sm text-muted">{i.meta}</span></Link></li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Container>
  );
}
