"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { runAction, parseForm, UserError, type ActionResult } from "@/server/errors";
import {
  assertUser,
  consumeToken,
  createSession,
  destroyOtherSessions,
  destroySession,
  hashPassword,
  issueToken,
  passwordPolicy,
  verifyPassword,
  verifyPasswordOrDummy,
} from "@/server/auth";
import { rateLimit } from "@/server/rate-limit";
import { clientIp, audit } from "@/server/audit";
import { notify, sendEmail } from "@/server/notifications";
import { siteUrl, getSettings } from "@/server/settings";

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);
const password = z.string().max(200).refine(passwordPolicy.test, passwordPolicy.message);

function safeNext(next: unknown) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

async function sendVerification(userId: string, to: string) {
  const token = await issueToken(userId, "EMAIL_VERIFY", 60 * 24);
  const url = `${await siteUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  const { siteName } = await getSettings("general");
  await sendEmail(to, `Confirm your ${siteName} account`, "Confirm your email address to activate your account. The link is valid for 24 hours.", url);
}

export async function registerAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const data = parseForm(
      z.object({
        name: z.string().trim().min(2, "Enter your name").max(120),
        email,
        phone: z.string().trim().max(20).optional().transform((v) => v || null),
        password,
        chessLevel: z.string().max(40).optional(),
        terms: z.literal("on", { message: "Please accept the community guidelines" }),
      }),
      formData,
    );
    if (!(await rateLimit(`register:${await clientIp()}`, 5, 3600))) throw new UserError("Too many sign-ups from this network. Please try again later.");
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      // Same response either way so the form cannot be used to discover accounts.
      if (!existing.emailVerifiedAt) await sendVerification(existing.id, existing.email);
      return { ok: true, message: "Check your inbox to confirm your email.", redirect: `/verify-email?sent=1&email=${encodeURIComponent(data.email)}` };
    }
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        passwordHash: await hashPassword(data.password),
        memberProfile: { create: { chessLevel: data.chessLevel || null } },
      },
    });
    await notify({ userId: user.id, type: "REGISTRATION", title: "Welcome to the clubhouse", body: "Your account is ready. Choose a membership or book your first session.", link: "/dashboard" });
    await sendVerification(user.id, user.email);
    await audit({ actorId: user.id, action: "user.register", entity: "User", entityId: user.id });
    return { ok: true, message: "Account created. Check your inbox to confirm your email.", redirect: `/verify-email?sent=1&email=${encodeURIComponent(data.email)}` };
  });
}

export async function resendVerificationAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const data = parseForm(z.object({ email }), formData);
    if (!(await rateLimit(`resend:${data.email}`, 3, 3600))) throw new UserError("Please wait before requesting another email.");
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (user && !user.emailVerifiedAt) await sendVerification(user.id, user.email);
    return { ok: true, message: "If that account needs confirming, a new link is on its way." };
  });
}

export async function verifyEmail(token: string) {
  const userId = await consumeToken(token, "EMAIL_VERIFY");
  if (!userId) return false;
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  await notify({ userId, type: "EMAIL_VERIFICATION", title: "Email confirmed", body: "Your email address is confirmed.", link: "/dashboard" });
  return true;
}

export async function loginAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const data = parseForm(z.object({ email, password: z.string().min(1, "Enter your password").max(200), next: z.string().optional() }), formData);
    const ip = await clientIp();
    if (!(await rateLimit(`login:ip:${ip}`, 20, 900)) || !(await rateLimit(`login:${data.email}`, 8, 900))) {
      throw new UserError("Too many sign-in attempts. Please wait 15 minutes.");
    }
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    const valid = await verifyPasswordOrDummy(data.password, user?.passwordHash);
    if (!user || !valid || user.deletedAt) throw new UserError("Incorrect email or password.");
    if (user.suspendedAt) throw new UserError("This account is suspended. Please contact the club.");
    if (!user.emailVerifiedAt) {
      await sendVerification(user.id, user.email);
      throw new UserError("Please confirm your email first — we've sent you a new link.");
    }
    await createSession(user.id);
    const dest = safeNext(data.next);
    const fallback = user.role === "MEMBER" ? "/dashboard" : user.role === "COACH" ? "/coach" : "/admin";
    return { ok: true, message: `Welcome back, ${user.name.split(" ")[0]}`, redirect: data.next ? dest : fallback };
  });
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}

export async function forgotPasswordAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const data = parseForm(z.object({ email }), formData);
    if (!(await rateLimit(`forgot:${await clientIp()}`, 5, 3600)) || !(await rateLimit(`forgot:${data.email}`, 3, 3600))) {
      throw new UserError("Too many reset requests. Please try again later.");
    }
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (user && !user.deletedAt && !user.suspendedAt) {
      const token = await issueToken(user.id, "PASSWORD_RESET", 60);
      await sendEmail(user.email, "Reset your password", "Use this link to choose a new password. It expires in 1 hour. If you didn't ask for this, you can ignore this email.", `${await siteUrl()}/reset-password?token=${encodeURIComponent(token)}`);
    }
    return { ok: true, message: "If an account exists for that email, a reset link is on its way." };
  });
}

export async function resetPasswordAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const data = parseForm(z.object({ token: z.string().min(10), password, confirm: z.string() }).refine((d) => d.password === d.confirm, { message: "Passwords do not match", path: ["confirm"] }), formData);
    const userId = await consumeToken(data.token, "PASSWORD_RESET");
    if (!userId) throw new UserError("This reset link is invalid or has expired. Please request a new one.");
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(data.password), emailVerifiedAt: new Date() } });
    await prisma.session.deleteMany({ where: { userId } });
    await audit({ actorId: userId, action: "user.password_reset", entity: "User", entityId: userId });
    return { ok: true, message: "Password updated. Please sign in.", redirect: "/login" };
  });
}

export async function changePasswordAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const data = parseForm(z.object({ current: z.string().min(1), password, confirm: z.string() }).refine((d) => d.password === d.confirm, { message: "Passwords do not match", path: ["confirm"] }), formData);
    const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(data.current, record.passwordHash))) throw new UserError("Your current password is incorrect.", { current: "Incorrect password" });
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(data.password) } });
    await destroyOtherSessions(user.id);
    await audit({ actorId: user.id, action: "user.password_change", entity: "User", entityId: user.id });
    return { ok: true, message: "Password changed. Other devices were signed out." };
  });
}
