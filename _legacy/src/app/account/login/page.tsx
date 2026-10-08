import Link from "next/link";
import { AuthFrame, AuthLinks } from "@/app/account/components/AuthForm";
import { loginAction } from "@/app/account/actions";
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; verified?: string; reset?: string; next?: string }> }) {
  const query = await searchParams;
  return <AuthFrame title={<>Welcome<br/><span>back.</span></>} notice={query.verified ? "Your email is verified. You can sign in now." : query.reset ? "Your password was updated. Sign in with the new password." : undefined} error={query.error ? "Email and password did not match, or your email still needs verification." : undefined}>
    <form action={loginAction} className="contact-form"><input type="hidden" name="next" value={query.next ?? ""}/><label>Email address<input name="email" type="email" autoComplete="username" maxLength={254} required/></label><label>Password<input name="password" type="password" autoComplete="current-password" maxLength={200} required/></label><button className="button" type="submit">Sign in <span>↗</span></button></form><AuthLinks><Link href="/account/forgot-password">Forgot your password?</Link><Link href="/account/register">Create an account →</Link></AuthLinks>
  </AuthFrame>;
}
