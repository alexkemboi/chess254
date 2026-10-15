import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { prisma } from "@/server/db";
import { AuthShell } from "@/components/site/auth-shell";
import { ClaimForm } from "@/components/forms/guest-forms";
import { BILLING_PERIOD_LABELS, formatMoney } from "@/lib/format";

export const metadata = { title: "Claim your membership", description: "Paid at the Paybill? Enter your M-Pesa code to activate your membership and create your account." };
export const dynamic = "force-dynamic";

export default async function ClaimPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const { done } = await searchParams;
  const plans = await prisma.membershipPlan.findMany({ where: { status: "ACTIVE" }, orderBy: [{ priority: "asc" }, { price: "asc" }] });
  return (
    <AuthShell title="Claim membership." subtitle="Paid at the Paybill? Enter the M-Pesa code from your SMS. We check it with Safaricom, activate your membership and email you a link to create your account.">
      {done ? (
        <div className="text-center">
          <CheckCircle2 className="mx-auto size-12 text-success" />
          <h2 className="mt-4 font-display text-2xl font-extrabold tracking-tight">Payment verified</h2>
          <p className="mt-2 text-muted">Your membership is active. Open the registration link we sent to <span className="font-medium text-foreground">{done}</span> to choose your password.</p>
          <p className="mt-6 text-sm text-muted">No email after a few minutes? <Link href="/complete-registration" className="text-brand-ink underline">Resend the link</Link></p>
        </div>
      ) : (
        <>
          <ClaimForm plans={plans.map((p) => ({ id: p.id, label: `${p.name} — ${formatMoney(p.price, p.currency)} / ${BILLING_PERIOD_LABELS[p.billingPeriod].short}` }))} />
          <p className="mt-6 text-center text-sm text-muted">Haven&apos;t paid yet? <Link href="/memberships" className="font-semibold text-brand-ink hover:underline">Pay by M-Pesa prompt</Link></p>
        </>
      )}
    </AuthShell>
  );
}
