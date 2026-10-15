import Link from "next/link";
import { peekSetupToken } from "@/server/account-setup";
import { AuthShell } from "@/components/site/auth-shell";
import { CompleteRegistrationForm, ResendSetupForm } from "@/components/forms/guest-forms";

export const metadata = { title: "Complete your registration", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CompleteRegistrationPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const user = token ? await peekSetupToken(token) : null;
  if (user && token) {
    return (
      <AuthShell title="Almost there." subtitle={`Welcome, ${user.name.split(" ")[0]}. Your membership is paid — choose a password for ${user.email} to finish.`}>
        <CompleteRegistrationForm token={token} />
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Registration link." subtitle={token ? "This link has expired or was already used. Request a fresh one below." : "Paid for a membership? We'll email you a link to create your account."}>
      <ResendSetupForm />
      <p className="mt-6 text-center text-sm text-muted">Already set up? <Link href="/login" className="font-semibold text-brand-ink hover:underline">Sign in</Link></p>
    </AuthShell>
  );
}
