import Link from "next/link";
import { AuthFrame, AuthLinks } from "@/app/account/components/AuthForm";
import { requestPasswordResetAction } from "@/app/account/actions";
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;
  return <AuthFrame title={<>Reset your<br/><span>password.</span></>} notice={sent ? "If an account matches that email, a reset link has been sent." : undefined}>
    <form action={requestPasswordResetAction} className="contact-form"><label>Email address<input name="email" type="email" autoComplete="email" maxLength={254} required/></label><button className="button" type="submit">Send reset link <span>↗</span></button></form><AuthLinks><Link href="/account/login">Back to sign in →</Link></AuthLinks>
  </AuthFrame>;
}
