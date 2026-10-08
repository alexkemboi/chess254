import type { Metadata } from "next";
import { Users } from "lucide-react";
import { prisma } from "@/server/db";
import { seoFor } from "@/server/content";
import { CoachCard, Container, PageHero } from "@/components/site/cards";
import { Reveal } from "@/components/site/reveal";
import { EmptyState } from "@/components/ui/misc";

export async function generateMetadata(): Promise<Metadata> {
  const seo = await seoFor("/coaches");
  return { title: seo?.title ?? "Coaches", description: seo?.description ?? "Meet the resident coaches at the clubhouse.", alternates: { canonical: "/coaches" } };
}

export default async function CoachesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const term = q?.trim().slice(0, 80);
  const coaches = await prisma.coachProfile.findMany({
    where: {
      isActive: true,
      user: { suspendedAt: null, deletedAt: null },
      ...(term ? { OR: [{ user: { name: { contains: term, mode: "insensitive" } } }, { headline: { contains: term, mode: "insensitive" } }, { specialties: { has: term } }] } : {}),
    },
    include: { user: { select: { name: true } } },
    orderBy: { position: "asc" },
  });
  return (
    <>
      <PageHero eyebrow="Resident coaches" title="Coaches who" highlight="play with you." body="Spar, review and improve with coaches who know your games." />
      <Container className="py-14">
        <form className="mb-8 max-w-md" role="search">
          <input name="q" defaultValue={term} placeholder="Search coaches or specialties…" className="h-11 w-full rounded-full border border-border bg-surface px-5 text-sm outline-none focus:border-brand" />
        </form>
        {coaches.length ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {coaches.map((c, i) => <Reveal key={c.id} delay={i * 70}><CoachCard coach={c} /></Reveal>)}
          </div>
        ) : (
          <EmptyState icon={<Users />} title={term ? "No coaches match that search" : "No coaches listed yet"} description={term ? "Try a different name or specialty." : "Coach profiles will appear here once the club adds them."} />
        )}
      </Container>
    </>
  );
}
