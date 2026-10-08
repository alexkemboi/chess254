import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { AuthShell } from "@/components/site/auth-shell";
import { LoginForm } from "@/components/forms/auth-forms";

export const metadata = { title: "Sign in", alternates: { canonical: "/login" } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await currentUser()) redirect(next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
  return (
    <AuthShell title="Welcome back." subtitle="Sign in to book sessions, pay with M-Pesa and track your progress.">
      <LoginForm next={next} />
    </AuthShell>
  );
}
