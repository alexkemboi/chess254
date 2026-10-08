import Link from "next/link";
import { AuthFrame, AuthLinks } from "@/app/account/components/AuthForm";
import { resetPasswordAction } from "@/app/account/actions";
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; result?: string }> }) {
  const { token, result } = await searchParams;
  if (!token || result) return <AuthFrame title={<>Choose a new<br/><span>password.</span></>} error={result ? "This reset link is invalid, expired, or already used." : undefined}><p className="auth-copy">Open a reset link from your email. Reset links expire after one hour.</p><AuthLinks><Link href="/account/forgot-password">Request another reset link →</Link></AuthLinks></AuthFrame>;
  return <AuthFrame title={<>Choose a new<br/><span>password.</span></>}><form action={resetPasswordAction} className="contact-form"><input type="hidden" name="token" value={token}/><label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={200} required/><span>At least 12 characters and one number.</span></label><label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={200} required/></label><button className="button" type="submit">Update password <span>↗</span></button></form></AuthFrame>;
}
