import { AuthShell } from "@/components/site/auth-shell";
import { ForgotForm } from "@/components/forms/auth-forms";

export const metadata = { title: "Reset password", robots: { index: false } };

export default function ForgotPage() {
  return (
    <AuthShell title="Forgot it?" subtitle="Enter your email and we'll send you a secure reset link.">
      <ForgotForm />
    </AuthShell>
  );
}
