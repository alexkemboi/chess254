import Link from "next/link";
import { AuthFrame } from "@/app/account/components/AuthForm";
import { verifyEmailAction } from "@/app/account/actions";
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string; result?: string }> }) {
  const { token, result } = await searchParams;
  if (!token || result) return <AuthFrame title={<>Verify your<br/><span>email.</span></>} error={result ? "This verification link is invalid or expired." : undefined}><p className="auth-copy">Open the verification link sent to your email. Verification links expire after 24 hours.</p><Link className="arrow-link" href="/account/login">Go to sign in →</Link></AuthFrame>;
  return <AuthFrame title={<>Verify your<br/><span>email.</span></>}><p className="auth-copy">Confirm that this email address belongs to you. This link can only be used once.</p><form action={verifyEmailAction} className="contact-form"><input type="hidden" name="token" value={token}/><button className="button" type="submit">Verify email <span>↗</span></button></form></AuthFrame>;
}
