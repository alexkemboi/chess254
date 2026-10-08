import type { Metadata } from "next";
import Link from "next/link";
import { Ticket } from "lucide-react";
import { prisma } from "@/server/db";
import { currentUser } from "@/server/auth";
import { getBlocks, seoFor } from "@/server/content";
import { activeMemberships } from "@/server/memberships";
import { Container, PageHero, PlanCard, SectionHeading } from "@/components/site/cards";
import { Reveal } from "@/components/site/reveal";
import { EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { CheckoutServiceButton } from "@/components/site/checkout-buttons";
import { FaqList } from "@/components/site/faq-list";
import { formatMoney } from "@/lib/format";
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
      <PageHero eyebrow={intro?.eyebrow ?? "Memberships"} title={intro?.title ?? "Memberships"} highlight={intro?.highlight} body={intro?.body} />
      <Container className="py-16">
        {plans.length ? (
          <div className={cn("grid gap-5", plans.length > 1 && "lg:grid-cols-2", plans.length > 2 && "xl:grid-cols-3")}>
            {plans.map((plan, i) => (
              <Reveal key={plan.id} delay={i * 100} className="h-full"><PlanCard plan={plan} current={mine.some((m) => m.planId === plan.id)} /></Reveal>
            ))}
          </div>
        ) : (
          <EmptyState title="No memberships are available right now" description="Please check back soon or contact the club." action={<Button asChild variant="secondary"><Link href="/contact">Contact us</Link></Button>} />
        )}

        {services.length > 0 && (
          <section className="mt-24">
            <SectionHeading eyebrow="No membership needed" title="Just visiting?" body="Pay per visit — perfect for trying the clubhouse first." />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {services.map((s) => (
                <div key={s.id} className="flex flex-col rounded-3xl border border-border bg-surface p-6">
                  <Ticket className="size-6 text-brand" />
                  <h3 className="mt-4 font-display text-2xl font-extrabold tracking-tight">{s.name}</h3>
                  <p className="mt-2 flex-1 text-sm text-muted">{s.description}</p>
                  <div className="mt-5 font-display text-3xl font-black">{formatMoney(s.price, s.currency)}</div>
                  <div className="mt-5">
                    {user ? <CheckoutServiceButton serviceId={s.id} label="Buy with M-Pesa" /> : <Button asChild variant="secondary" className="w-full"><Link href="/login?next=/memberships">Sign in to buy</Link></Button>}
                  </div>
                </div>
              ))}
            </div>
          </section>
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
