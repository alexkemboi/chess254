import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Clock, Download, Lock } from "lucide-react";
import { prisma } from "@/server/db";
import { currentUser } from "@/server/auth";
import { materialAccess, publishedMaterialWhere } from "@/server/learning";
import { Container } from "@/components/site/cards";
import { Img } from "@/components/ui/img";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LearningControls } from "@/components/site/learning-controls";
import { PgnViewer } from "@/components/chess/pgn-viewer";
import { humanize } from "@/lib/format";

async function load(slug: string) {
  return prisma.learningMaterial.findFirst({ where: publishedMaterialWhere({ slug }), include: { category: true } });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const m = await load((await params).slug);
  if (!m) return { title: "Lesson not found" };
  return { title: m.title, description: m.summary.slice(0, 160), alternates: { canonical: `/learn/${m.slug}` }, openGraph: { type: "article", images: m.coverImage ? [m.coverImage] : undefined } };
}

/** Only YouTube and Vimeo embeds are allowed. */
function embedUrl(url: string) {
  try {
    const u = new URL(url);
    if (/(^|\.)youtube\.com$/.test(u.hostname) && u.searchParams.get("v")) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.searchParams.get("v")!)}`;
    if (u.hostname === "youtu.be") return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.pathname.slice(1))}`;
    if (/(^|\.)vimeo\.com$/.test(u.hostname)) return `https://player.vimeo.com/video/${encodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "")}`;
  } catch {}
  return null;
}

export default async function MaterialPage({ params }: { params: Promise<{ slug: string }> }) {
  const material = await load((await params).slug);
  if (!material) notFound();
  const user = await currentUser();
  const access = await materialAccess(material, user);
  const [progress, bookmark, related] = await Promise.all([
    user ? prisma.learningProgress.findUnique({ where: { userId_materialId: { userId: user.id, materialId: material.id } } }) : null,
    user ? prisma.learningBookmark.findUnique({ where: { userId_materialId: { userId: user.id, materialId: material.id } } }) : null,
    prisma.learningMaterial.findMany({ where: publishedMaterialWhere({ categoryId: material.categoryId, id: { not: material.id } }), take: 3, orderBy: { position: "asc" } }),
  ]);
  const video = material.videoUrl ? embedUrl(material.videoUrl) : null;

  return (
    <Container className="max-w-5xl py-12 sm:py-16">
      <Link href={`/learn?category=${material.category.slug}`} className="text-sm text-muted hover:text-foreground">← {material.category.name}</Link>
      <div className="mt-6 flex flex-wrap gap-2">
        <Badge>{humanize(material.type)}</Badge>
        {material.level && <Badge variant="neutral">{material.level}</Badge>}
        {material.access === "MEMBERS" && <Badge variant="neutral"><Lock className="size-3" />Members</Badge>}
        {material.durationMinutes && <Badge variant="neutral"><Clock className="size-3" />{material.durationMinutes} min</Badge>}
      </div>
      <h1 className="display mt-5 text-[clamp(2.4rem,6vw,4.4rem)]">{material.title}</h1>
      <p className="mt-5 max-w-3xl text-lg text-muted">{material.summary}</p>
      {user && access.canView && <div className="mt-7"><LearningControls materialId={material.id} bookmarked={Boolean(bookmark)} status={progress?.status ?? "NONE"} /></div>}

      {material.coverImage && (
        <div className="relative mt-10 aspect-[21/9] overflow-hidden rounded-3xl border border-border">
          <Img src={material.coverImage} alt="" fill priority sizes="(max-width: 1024px) 100vw, 1024px" className="object-cover" />
        </div>
      )}

      {access.canView ? (
        <div className="mt-10 grid gap-10">
          {video && (
            <div className="relative aspect-video overflow-hidden rounded-3xl border border-border bg-black">
              <iframe src={video} title={material.title} className="absolute inset-0 size-full" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
            </div>
          )}
          {material.pgn && <PgnViewer pgn={material.pgn} />}
          {material.body && <article className="prose-chess max-w-3xl"><ReactMarkdown remarkPlugins={[remarkGfm]}>{material.body}</ReactMarkdown></article>}
          {material.type === "PUZZLE" && <Button asChild size="lg" className="w-fit"><Link href="/puzzles">Open the puzzle room</Link></Button>}
          {material.fileUrl && (
            access.canDownload ? (
              <Button asChild variant="secondary" size="lg" className="w-fit"><a href={`/learn/${material.slug}/download`}><Download />Download {material.type === "PGN" ? "PGN" : "file"}</a></Button>
            ) : (
              <p className="text-sm text-muted">{access.reason ?? "Downloads are not available for this lesson."}</p>
            )
          )}
          {material.pgn && access.canDownload && !material.fileUrl && (
            <Button asChild variant="secondary" className="w-fit"><a href={`/learn/${material.slug}/download`}><Download />Download PGN</a></Button>
          )}
        </div>
      ) : (
        <div className="mt-10 rounded-3xl border border-brand/30 bg-gradient-to-br from-brand/10 to-surface p-8 text-center sm:p-12">
          <Lock className="mx-auto size-10 text-brand-ink" />
          <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight">Members-only lesson</h2>
          <p className="mx-auto mt-2 max-w-md text-muted">{access.reason}</p>
          <div className="mt-6 flex justify-center gap-2">
            {!user && <Button asChild variant="secondary"><Link href={`/login?next=/learn/${material.slug}`}>Sign in</Link></Button>}
            <Button asChild><Link href="/memberships">See memberships</Link></Button>
          </div>
        </div>
      )}

      {related.length > 0 && (
        <section className="mt-20">
          <h2 className="font-display text-2xl font-bold tracking-tight">Keep learning</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {related.map((r) => (
              <Link key={r.id} href={`/learn/${r.slug}`} className="rounded-2xl border border-border bg-surface p-5 transition hover:border-brand/50">
                <div className="text-xs text-brand-ink">{humanize(r.type)}</div>
                <div className="mt-1 font-semibold">{r.title}</div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </Container>
  );
}
