import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarCheck, Clock } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { prisma } from "@/server/db";
import { getAllSettings } from "@/server/settings";
import { Container } from "@/components/site/cards";
import { Img } from "@/components/ui/img";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WEEKDAYS, formatClock, formatMoney } from "@/lib/format";
import { initials, plainText, truncate } from "@/lib/utils";

async function load(slug: string) {
  return prisma.coachProfile.findFirst({
    where: { slug, isActive: true, user: { suspendedAt: null, deletedAt: null } },
    include: { user: { select: { name: true } }, availability: { orderBy: [{ weekday: "asc" }, { startTime: "asc" }] }, sessionTypes: { where: { status: "ACTIVE" }, orderBy: { position: "asc" } } },
  });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const coach = await load((await params).slug);
  if (!coach) return { title: "Coach not found" };
  return {
    title: coach.user.name,
    description: coach.headline ?? truncate(plainText(coach.bio), 160),
    alternates: { canonical: `/coaches/${coach.slug}` },
    openGraph: { images: coach.imageUrl ? [coach.imageUrl] : undefined },
  };
}

export default async function CoachPage({ params }: { params: Promise<{ slug: string }> }) {
  const coach = await load((await params).slug);
  if (!coach) notFound();
  const { general } = await getAllSettings();
  const jsonLd = { "@context": "https://schema.org", "@type": "Person", name: coach.user.name, jobTitle: coach.title ?? "Chess coach", description: coach.headline ?? undefined, image: coach.imageUrl ?? undefined, worksFor: { "@type": "Organization", name: general.siteName } };
  return (
    <Container className="py-12 sm:py-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <Link href="/coaches" className="text-sm text-muted hover:text-foreground">← All coaches</Link>
      <div className="mt-6 grid gap-10 lg:grid-cols-[380px_1fr]">
        <div className="relative aspect-[4/5] overflow-hidden rounded-3xl border border-border bg-surface-2">
          {coach.imageUrl ? <Img src={coach.imageUrl} alt={coach.user.name} fill sizes="380px" className="object-cover" priority /> : <div className="checker absolute inset-0 grid place-items-center font-display text-8xl font-black text-brand/60">{initials(coach.user.name)}</div>}
        </div>
        <div>
          {coach.title && <div className="eyebrow">{coach.title}</div>}
          <h1 className="display mt-3 text-[clamp(2.8rem,7vw,5rem)]">{coach.user.name}</h1>
          {coach.headline && <p className="mt-4 text-xl text-muted">{coach.headline}</p>}
          <div className="mt-5 flex flex-wrap gap-2">
            {coach.rating && <Badge variant="solid">Rating {coach.rating}</Badge>}
            {coach.specialties.map((s) => <Badge key={s} variant="neutral">{s}</Badge>)}
          </div>
          <div className="prose-chess mt-8 max-w-2xl"><ReactMarkdown>{coach.bio}</ReactMarkdown></div>
          {coach.acceptsBookings && coach.sessionTypes.length > 0 && (
            <div className="mt-10">
              <h2 className="font-display text-2xl font-bold tracking-tight">Book {coach.user.name.split(" ")[0]}</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {coach.sessionTypes.map((s) => (
                  <Link key={s.id} href={`/book?type=${s.id}&coach=${coach.slug}`} className="group rounded-2xl border border-border bg-surface p-5 transition hover:border-brand">
                    <div className="flex justify-between gap-2"><span className="font-semibold group-hover:text-brand">{s.name}</span><span className="font-mono text-sm text-brand">{s.price.greaterThan(0) ? formatMoney(s.price, s.currency) : "Included"}</span></div>
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted"><Clock className="size-3.5" />{s.durationMinutes} min</div>
                  </Link>
                ))}
              </div>
              <Button asChild size="lg" className="mt-6"><Link href={`/book?coach=${coach.slug}`}><CalendarCheck />See live availability</Link></Button>
            </div>
          )}
          {coach.availability.length > 0 && (
            <div className="mt-10 rounded-3xl border border-border bg-surface p-6">
              <h3 className="font-semibold">Usual coaching hours</h3>
              <ul className="mt-3 grid gap-1.5 text-sm text-muted sm:grid-cols-2">
                {coach.availability.map((a) => <li key={a.id}><span className="text-foreground">{WEEKDAYS[a.weekday]}</span> · {formatClock(a.startTime)} – {formatClock(a.endTime)}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Container>
  );
}
