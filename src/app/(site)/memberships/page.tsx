import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db";
import { currentUser } from "@/server/auth";
import { getBlocks, seoFor } from "@/server/content";
import { activeMemberships } from "@/server/memberships";
import { Container, PageHero, PassCard, PlanCard, SectionHeading } from "@/components/site/cards";
import { Reveal } from "@/components/site/reveal";
import { EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { CheckoutServiceButton } from "@/components/site/checkout-buttons";
import { FaqList } from "@/components/site/faq-list";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const seo = await seoFor("/memberships");
  const plans = await prisma.membershipPlan.findMany({ where: { status: "ACTIVE" }, select: { name: true }, orderBy: { priority: "asc" } });
  return {
    title: seo?.title ?? "Memberships",
    description: seo?.description ?? (plans.length ? `Choose your membership: ${plans.map((p) => p.name).join(", ")}.` : undefined),
    alternates: { canonical: "/memberships" },
  };
}

export default async function MembershipsPage() {
  const user = await currentUser();
  const [plans, services, faqs, blocks, mine] = await Promise.all([
    prisma.membershipPlan.findMany({ where: { status: "ACTIVE" }, include: { features: { orderBy: { position: "asc" } } }, orderBy: [{ priority: "asc" }, { price: "asc" }] }),
    prisma.service.findMany({ where: { status: "ACTIVE" }, orderBy: { position: "asc" } }),
    prisma.fAQ.findMany({ where: { visible: true }, orderBy: { position: "asc" } }),
    getBlocks("home"),
    user ? activeMemberships(user.id) : Promise.resolve([]),
  ]);
  const intro = blocks.get("home.memberships");
  return (
    <>
      <PageHero glyph="♔" eyebrow={intro?.eyebrow ?? "Memberships"} title={intro?.title ?? "Memberships"} highlight={intro?.highlight} body={intro?.body} />
      <Container className="py-16">
        {plans.length || services.length ? (
          // Pay-per-visit passes come first, then the plans, all in one row on large screens.
          <div className={cn("grid gap-5", plans.length + services.length > 1 && "md:grid-cols-2", plans.length + services.length === 3 && "lg:grid-cols-3", plans.length + services.length >= 4 && "lg:grid-cols-2 xl:grid-cols-4")}>
            {services.map((s, i) => (
              <Reveal key={s.id} delay={i * 100} className="h-full">
                <PassCard
                  pass={s}
                  action={user ? <CheckoutServiceButton serviceId={s.id} label="Buy with M-Pesa" size="lg" /> : <Button asChild variant="secondary" size="lg" className="w-full"><Link href="/login?next=/memberships">Sign in to buy</Link></Button>}
                />
              </Reveal>
            ))}
            {plans.map((plan, i) => (
              <Reveal key={plan.id} delay={(services.length + i) * 100} className="h-full"><PlanCard plan={plan} current={mine.some((m) => m.planId === plan.id)} /></Reveal>
            ))}
          </div>
        ) : (
          <EmptyState title="No memberships are available right now" description="Please check back soon or contact the club." action={<Button asChild variant="secondary"><Link href="/contact">Contact us</Link></Button>} />
        )}

        {faqs.length > 0 && (
          <section className="mt-24">
            <SectionHeading eyebrow="Questions" title="Good to" highlight="know." />
            <FaqList faqs={faqs} />
          </section>
        )}
      </Container>
    </>
  );
}
