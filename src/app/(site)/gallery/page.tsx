import type { Metadata } from "next";
import Link from "next/link";
import { ImageIcon } from "lucide-react";
import { prisma } from "@/server/db";
import { seoFor } from "@/server/content";
import { Container, PageHero } from "@/components/site/cards";
import { GalleryGrid } from "@/components/site/gallery-grid";
import { EmptyState } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const seo = await seoFor("/gallery");
  const cover = await prisma.galleryImage.findFirst({ where: { visible: true, deletedAt: null, featured: true }, orderBy: { position: "asc" } });
  return { title: seo?.title ?? "Gallery", description: seo?.description ?? "Moments from the clubhouse — players, coaching, events and community.", alternates: { canonical: "/gallery" }, openGraph: { images: cover ? [cover.imageUrl] : undefined } };
}

export default async function GalleryPage({ searchParams }: { searchParams: Promise<{ category?: string; q?: string }> }) {
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 80);
  const categories = await prisma.galleryCategory.findMany({ orderBy: { position: "asc" }, include: { _count: { select: { images: { where: { visible: true, deletedAt: null } } } } } });
  const category = categories.find((c) => c.slug === sp.category);
  const photos = await prisma.galleryImage.findMany({
    where: {
      visible: true,
      deletedAt: null,
      ...(category ? { categoryId: category.id } : {}),
      ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { caption: { contains: q, mode: "insensitive" } }] } : {}),
    },
    include: { category: true },
    orderBy: [{ featured: "desc" }, { position: "asc" }],
  });
  const chip = (active: boolean) => cn("whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition", active ? "border-brand bg-brand text-brand-foreground" : "border-border text-muted hover:text-foreground");
  return (
    <>
      <PageHero glyph="♝" eyebrow="Gallery" title="The clubhouse" highlight="in motion." body="Players, coaching, community nights and tournaments." />
      <Container className="py-12">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            <Link href="/gallery" className={chip(!category)}>All</Link>
            {categories.filter((c) => c._count.images > 0).map((c) => (
              <Link key={c.id} href={`/gallery?category=${c.slug}`} className={chip(category?.id === c.id)}>{c.name} <span className="opacity-60">{c._count.images}</span></Link>
            ))}
          </div>
          <form role="search" className="w-full lg:w-64">
            {category && <input type="hidden" name="category" value={category.slug} />}
            <input name="q" defaultValue={q} placeholder="Search photos…" className="h-11 w-full rounded-full border border-border bg-surface px-5 text-sm outline-none focus:border-brand" />
          </form>
        </div>
        {photos.length ? (
          <GalleryGrid photos={photos.map((p) => ({ id: p.id, title: p.title, caption: p.caption, imageUrl: p.imageUrl, alt: p.alt, width: p.width, height: p.height, category: p.category?.name ?? null }))} />
        ) : (
          <EmptyState icon={<ImageIcon />} title="No photos here yet" description={category || q ? "Try another category." : "Club moments will appear here as they're added."} />
        )}
      </Container>
    </>
  );
}
