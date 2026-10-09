import Link from "next/link";
import { CheckCircle2, MailCheck, XCircle } from "lucide-react";
import { verifyEmail } from "@/actions/auth";
import { AuthShell } from "@/components/site/auth-shell";
import { ResendForm } from "@/components/forms/auth-forms";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Confirm your email", robots: { index: false } };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string; sent?: string; email?: string }> }) {
  const { token, email } = await searchParams;
  if (token) {
    const ok = await verifyEmail(token);
    return (
      <AuthShell title={ok ? "You're in." : "Link expired."}>
        <div className="flex items-start gap-4 rounded-2xl border border-border bg-surface p-5">
          {ok ? <CheckCircle2 className="size-6 shrink-0 text-success" /> : <XCircle className="size-6 shrink-0 text-danger" />}
          <p className="text-muted">{ok ? "Your email is confirmed. Sign in to choose a membership or book your first session." : "This confirmation link is invalid or has already been used. Request a fresh one below."}</p>
        </div>
        <div className="mt-6">{ok ? <Button asChild size="lg" className="w-full"><Link href="/login">Sign in</Link></Button> : <ResendForm email={email} />}</div>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Check your inbox." subtitle={email ? <>We sent a confirmation link to <span className="text-foreground">{email}</span>.</> : "We sent you a confirmation link."}>
      <div className="mb-6 flex items-start gap-4 rounded-2xl border border-border bg-surface p-5">
        <MailCheck className="size-6 shrink-0 text-brand-ink" />
        <p className="text-sm text-muted">Open the email and tap the link to activate your account. It’s valid for 24 hours.</p>
      </div>
      <ResendForm email={email} />
    </AuthShell>
  );
}
