import Link from "next/link";
import { AuthFrame, AuthLinks } from "@/app/account/components/AuthForm";
import { registerAction } from "@/app/account/actions";
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string; mail?: string }> }) {
  const query = await searchParams;
  if (query.sent) return <AuthFrame title={<>Check your<br/><span>inbox.</span></>} notice="If this address can be registered, we’ve sent an email verification link. Check your spam folder too."><AuthLinks><Link href="/account/login">Already verified? Sign in →</Link></AuthLinks></AuthFrame>;
  return <AuthFrame title={<>Create your<br/><span>account.</span></>} error={query.error === "rate" ? "Too many attempts. Please wait and try again." : query.error ? "Check your details. Use a password of at least 12 characters, including a number." : undefined}>
    {query.mail && <div className="notice">Your account was saved, but email delivery is unavailable. Contact the club to complete verification.</div>}
    <form action={registerAction} className="contact-form"><label>Your name<input name="name" autoComplete="name" minLength={2} maxLength={100} required/></label><label>Email address<input name="email" type="email" autoComplete="email" maxLength={254} required/></label><label>Password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={200} required/><span>At least 12 characters and one number.</span></label><label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={200} required/></label><button className="button" type="submit">Create account <span>↗</span></button></form><AuthLinks><Link href="/account/login">Already have an account? Sign in →</Link></AuthLinks>
  </AuthFrame>;
}
