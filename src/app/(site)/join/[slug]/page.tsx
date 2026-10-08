import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ShieldCheck } from "lucide-react";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { activeMemberships } from "@/server/memberships";
import { getAllSettings } from "@/server/settings";
import { Container } from "@/components/site/cards";
import { CheckoutPlanButton } from "@/components/site/checkout-buttons";
import { Badge } from "@/components/ui/badge";
import { BILLING_PERIOD_LABELS, formatDate, formatMoney } from "@/lib/format";

export const metadata = { title: "Join", robots: { index: false } };

export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser(`/join/${slug}`);
  const plan = await prisma.membershipPlan.findFirst({ where: { slug, status: "ACTIVE" }, include: { features: { orderBy: { position: "asc" } } } });
  if (!plan) notFound();
  const settings = await getAllSettings();
  const mine = await activeMemberships(user.id);
  const current = mine.find((m) => m.planId === plan.id);
  const period = BILLING_PERIOD_LABELS[plan.billingPeriod];
  const renewBlocked = current && !settings.membership.allowEarlyRenewal;

  return (
    <Container className="max-w-4xl py-14 sm:py-20">
      <Link href="/memberships" className="text-sm text-muted hover:text-foreground">← All memberships</Link>
      <div className="mt-6 grid gap-6 md:grid-cols-[1.2fr_1fr]">
        <div className="rounded-3xl border border-border bg-surface p-7">
          {plan.audience && <div className="eyebrow">{plan.audience}</div>}
          <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight">{plan.name}</h1>
          <p className="mt-3 text-muted">{plan.description}</p>
          <ul className="mt-6 grid gap-3">
            {plan.features.map((f) => (
              <li key={f.id} className="flex gap-3 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-brand" />{f.label}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col rounded-3xl border border-brand/40 bg-gradient-to-b from-brand/10 to-surface p-7">
          <div className="text-sm text-muted">{period.long} membership</div>
          <div className="mt-2 font-display text-5xl font-black tracking-tight">{formatMoney(plan.price, plan.currency)}</div>
          <div className="text-sm text-muted">per {period.short}</div>
          {current?.expiresAt && (
            <div className="mt-6 rounded-2xl border border-border bg-black/30 p-4 text-sm">
              <Badge variant="success">Active</Badge>
              <p className="mt-2 text-muted">Your membership runs until <span className="text-foreground">{formatDate(current.expiresAt, settings.general.timezone)}</span>.{!renewBlocked && " Renewing now adds a full period on top."}</p>
            </div>
          )}
          <div className="mt-auto pt-8">
            {renewBlocked ? (
              <p className="text-sm text-muted">You can renew once your current period ends.</p>
            ) : (
              <CheckoutPlanButton planId={plan.id} label={current ? "Renew with M-Pesa" : "Continue to payment"} />
            )}
            <p className="mt-4 flex items-center gap-2 text-xs text-muted"><ShieldCheck className="size-3.5 text-brand" />Activated automatically once M-Pesa confirms your payment.</p>
          </div>
        </div>
      </div>
    </Container>
  );
}
