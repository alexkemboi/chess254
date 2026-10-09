import Link from "next/link";
import { AuthShell } from "@/components/site/auth-shell";
import { ResetForm } from "@/components/forms/auth-forms";

export const metadata = { title: "Choose a new password", robots: { index: false } };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell title="New password." subtitle="Choose a strong password you haven't used before.">
      {token ? <ResetForm token={token} /> : <p className="text-muted">This link is missing its token. <Link href="/forgot-password" className="text-brand-ink underline">Request a new one</Link>.</p>}
    </AuthShell>
  );
}
