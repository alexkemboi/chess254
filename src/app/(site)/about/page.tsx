import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getBlocks, seoFor } from "@/server/content";
import { Container, PageHero } from "@/components/site/cards";
import { Reveal } from "@/components/site/reveal";
import { Img } from "@/components/ui/img";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const [seo, blocks] = await Promise.all([seoFor("/about"), getBlocks("about")]);
  const intro = [...blocks.values()][0];
  return { title: seo?.title ?? "About", description: seo?.description ?? intro?.body?.slice(0, 160), alternates: { canonical: "/about" } };
}

export default async function AboutPage() {
  const blocks = [...(await getBlocks("about")).values()];
  const [intro, ...rest] = blocks;
  if (!intro) return <Container className="py-24"><EmptyState title="About page coming soon" /></Container>;
  return (
    <>
      <PageHero eyebrow={intro.eyebrow} title={intro.title ?? "About"} highlight={intro.highlight} body={intro.body} />
      {intro.imageUrl && (
        <Container className="-mt-6 pb-8">
          <div className="relative aspect-[21/9] overflow-hidden rounded-[2rem] border border-border">
            <Img src={intro.imageUrl} alt={intro.title ?? ""} fill sizes="100vw" className="object-cover" priority />
          </div>
        </Container>
      )}
      {rest.map((b, i) => (
        <section key={b.key} className="py-20">
          <Container className={cn("grid items-center gap-12 lg:grid-cols-2", i % 2 === 1 && "lg:[&>*:first-child]:order-2")}>
            <Reveal>
              {b.eyebrow && <div className="eyebrow mb-4">{b.eyebrow}</div>}
              <h2 className="display text-[clamp(2.2rem,5vw,4rem)]">{b.title} {b.highlight && <span className="text-brand">{b.highlight}</span>}</h2>
              {b.body && <p className="mt-6 text-lg leading-relaxed text-muted">{b.body}</p>}
              {b.items.length > 0 && (
                <ul className="mt-6 grid gap-2">
                  {b.items.map((it) => <li key={it.title} className="flex items-center gap-3 font-display text-xl font-bold"><span className="text-brand">♞</span>{it.title}</li>)}
                </ul>
              )}
              {b.ctaLabel && b.ctaHref && <Button asChild className="mt-8"><Link href={b.ctaHref}>{b.ctaLabel}<ArrowRight /></Link></Button>}
            </Reveal>
            {b.imageUrl && (
              <Reveal delay={120} className="relative aspect-[4/5] overflow-hidden rounded-[2rem] border border-border">
                <Img src={b.imageUrl} alt={b.title ?? ""} fill sizes="(max-width: 1024px) 100vw, 50vw" className="object-cover" />
              </Reveal>
            )}
          </Container>
        </section>
      ))}
    </>
  );
}
