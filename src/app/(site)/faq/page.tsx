import type { Metadata } from "next";
import { HelpCircle } from "lucide-react";
import { prisma } from "@/server/db";
import { seoFor } from "@/server/content";
import { Container, PageHero } from "@/components/site/cards";
import { FaqList } from "@/components/site/faq-list";
import { EmptyState } from "@/components/ui/misc";

export async function generateMetadata(): Promise<Metadata> {
  const seo = await seoFor("/faq");
  return { title: seo?.title ?? "FAQ", description: seo?.description ?? "Answers to common questions about the clubhouse.", alternates: { canonical: "/faq" } };
}

export default async function FaqPage() {
  const faqs = await prisma.fAQ.findMany({ where: { visible: true }, orderBy: [{ category: "asc" }, { position: "asc" }] });
  const groups = faqs.reduce<Map<string, typeof faqs>>((m, f) => m.set(f.category ?? "General", [...(m.get(f.category ?? "General") ?? []), f]), new Map());
  const jsonLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })) };
  return (
    <>
      {faqs.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />}
      <PageHero glyph="♟" eyebrow="Help" title="Questions," highlight="answered." />
      <Container className="max-w-4xl py-14">
        {faqs.length ? (
          <div className="grid gap-12">
            {[...groups.entries()].map(([group, list]) => (
              <section key={group}>
                <h2 className="eyebrow mb-4">{group}</h2>
                <FaqList faqs={list} />
              </section>
            ))}
          </div>
        ) : (
          <EmptyState icon={<HelpCircle />} title="No FAQs yet" description="Questions and answers will appear here soon." />
        )}
      </Container>
    </>
  );
}
