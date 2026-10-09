import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Clock, FileText, Lock, PlayCircle, Puzzle, Swords, ClipboardList, Bookmark } from "lucide-react";
import type { MaterialType, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { currentUser } from "@/server/auth";
import { seoFor } from "@/server/content";
import { publishedMaterialWhere } from "@/server/learning";
import { Container, PageHero } from "@/components/site/cards";
import { Reveal } from "@/components/site/reveal";
import { EmptyState } from "@/components/ui/misc";
import { Img } from "@/components/ui/img";
import { Badge } from "@/components/ui/badge";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<MaterialType, typeof BookOpen> = { ARTICLE: BookOpen, PDF: FileText, VIDEO: PlayCircle, STUDY: Swords, PGN: Swords, PUZZLE: Puzzle, ASSIGNMENT: ClipboardList };
const TYPES = Object.keys(TYPE_ICONS) as MaterialType[];

export async function generateMetadata(): Promise<Metadata> {
  const seo = await seoFor("/learn");
  return { title: seo?.title ?? "Chess Academy", description: seo?.description ?? "Lessons, studies and annotated games from the Chess254 academy.", alternates: { canonical: "/learn" } };
}

export default async function LearnPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; type?: string; level?: string; saved?: string }> }) {
  const sp = await searchParams;
  const user = await currentUser();
  const q = sp.q?.trim().slice(0, 80);
  const type = TYPES.includes(sp.type as MaterialType) ? (sp.type as MaterialType) : undefined;
  const [categories, levels] = await Promise.all([
    prisma.learningCategory.findMany({ where: { visible: true }, orderBy: { position: "asc" }, include: { _count: { select: { materials: { where: publishedMaterialWhere() } } } } }),
    prisma.learningMaterial.findMany({ where: publishedMaterialWhere({ level: { not: null } }), distinct: ["level"], select: { level: true } }),
  ]);
  const category = categories.find((c) => c.slug === sp.category);
  const where: Prisma.LearningMaterialWhereInput = publishedMaterialWhere({
    ...(category ? { categoryId: category.id } : {}),
    ...(type ? { type } : {}),
    ...(sp.level ? { level: sp.level } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { summary: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }] } : {}),
    ...(sp.saved && user ? { bookmarks: { some: { userId: user.id } } } : {}),
  });
  const materials = await prisma.learningMaterial.findMany({ where, include: { category: true }, orderBy: [{ position: "asc" }, { createdAt: "desc" }], take: 90 });
  const progress = user ? await prisma.learningProgress.findMany({ where: { userId: user.id, materialId: { in: materials.map((m) => m.id) } } }) : [];
  const status = new Map(progress.map((p) => [p.materialId, p.status]));
  const link = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams(Object.entries({ q, category: category?.slug, type, level: sp.level, saved: sp.saved, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/learn${params.size ? `?${params}` : ""}`;
  };
  const chip = (active: boolean) => cn("whitespace-nowrap rounded-full border px-4 py-2 text-[15px] font-semibold transition", active ? "border-brand bg-brand text-brand-foreground" : "border-border text-muted hover:text-foreground");

  return (
    <>
      <PageHero glyph="♝" eyebrow="Chess254 Academy" title="Learn the game," highlight="properly." body="Openings, tactics, strategy and endgames — structured lessons you can study between games." />
      <Container className="py-12">
        <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
          <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
            <form role="search" className="mb-6">
              {category && <input type="hidden" name="category" value={category.slug} />}
              <input name="q" defaultValue={q} placeholder="Search lessons…" className="h-11 w-full rounded-full border border-border bg-surface px-5 text-sm outline-none focus:border-brand" />
            </form>
            <div className="eyebrow mb-3 text-foreground">Categories</div>
            <nav className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0">
              <Link href={link({ category: undefined })} className={cn(chip(!category), "lg:rounded-xl lg:text-left")}>All topics</Link>
              {categories.map((c) => (
                <Link key={c.id} href={link({ category: c.slug })} className={cn(chip(category?.id === c.id), "flex items-center justify-between gap-3 lg:rounded-xl")}>
                  {c.name}<span className="text-xs opacity-60">{c._count.materials}</span>
                </Link>
              ))}
            </nav>
            {user && <Link href={link({ saved: sp.saved ? undefined : "1" })} className={cn(chip(Boolean(sp.saved)), "mt-4 inline-flex items-center gap-2")}><Bookmark className="size-4" />Saved</Link>}
          </aside>
          <div className="min-w-0">
            <div className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4">
              <Link href={link({ type: undefined })} className={chip(!type)}>All formats</Link>
              {TYPES.map((t) => <Link key={t} href={link({ type: t })} className={chip(type === t)}>{humanize(t)}</Link>)}
              {levels.length > 0 && <span className="mx-1 w-px shrink-0 bg-border" />}
              {levels.map((l) => l.level && <Link key={l.level} href={link({ level: sp.level === l.level ? undefined : l.level })} className={chip(sp.level === l.level)}>{l.level}</Link>)}
            </div>
            {category?.description && <p className="mb-6 text-muted">{category.description}</p>}
            {materials.length ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {materials.map((m, i) => {
                  const Icon = TYPE_ICONS[m.type];
                  const s = status.get(m.id);
                  return (
                    <Reveal key={m.id} delay={(i % 3) * 70}>
                      <Link href={`/learn/${m.slug}`} className="group flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-surface transition hover:-translate-y-1 hover:border-brand/50">
                        <div className="relative aspect-[16/9] overflow-hidden bg-surface-2">
                          {m.coverImage ? <Img src={m.coverImage} alt="" fill sizes="(max-width: 640px) 100vw, 33vw" className="object-cover transition duration-700 group-hover:scale-105" /> : <div className="art-tile absolute inset-0 grid place-items-center"><span className="grid size-16 place-items-center rounded-2xl bg-white/[0.06] ring-1 ring-white/10 backdrop-blur-sm transition duration-500 group-hover:scale-110 group-hover:bg-brand/15"><Icon className="size-8 text-brand" /></span></div>}
                          <div className="absolute left-3 top-3 flex gap-1.5">
                            <Badge variant="solid">{humanize(m.type)}</Badge>
                            {m.access === "MEMBERS" && <Badge variant="neutral" className="on-dark bg-black/70"><Lock className="size-3.5" />Members</Badge>}
                          </div>
                          {s && <Badge variant={s === "COMPLETED" ? "success" : "default"} className="absolute right-3 top-3 bg-black/70 on-dark">{s === "COMPLETED" ? "Done" : "In progress"}</Badge>}
                        </div>
                        <div className="flex flex-1 flex-col p-5">
                          <div className="text-[15px] font-bold text-brand-ink">{m.category.name}</div>
                          <h3 className="mt-1.5 font-display text-[1.375rem] font-extrabold leading-snug tracking-tight group-hover:text-brand-ink">{m.title}</h3>
                          <p className="mt-2 line-clamp-3 text-base leading-relaxed text-muted">{m.summary}</p>
                          <div className="mt-auto flex gap-4 pt-4 text-sm text-muted">
                            {m.level && <span className="font-semibold">{m.level}</span>}
                            {m.durationMinutes && <span className="flex items-center gap-1"><Clock className="size-4" />{m.durationMinutes} min</span>}
                          </div>
                        </div>
                      </Link>
                    </Reveal>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={<BookOpen />} title={q || type || category || sp.level || sp.saved ? "No lessons match" : "No learning materials yet"} description={q || type || category ? "Try another search or filter." : "The academy will be stocked soon."} />
            )}
          </div>
        </div>
      </Container>
    </>
  );
}
