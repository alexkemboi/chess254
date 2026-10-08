import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { AuthShell } from "@/components/site/auth-shell";
import { RegisterForm } from "@/components/forms/auth-forms";

export const metadata = { title: "Create an account", alternates: { canonical: "/register" } };

export default async function RegisterPage() {
  if (await currentUser()) redirect("/dashboard");
  const [{ guidelines }, { joinIntro }] = await Promise.all([getSettings("community"), getSettings("membership")]);
  return (
    <AuthShell title="Pull up a chair." subtitle={joinIntro || undefined}>
      <RegisterForm guidelines={guidelines} />
    </AuthShell>
  );
}
