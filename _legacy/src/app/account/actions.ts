"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { clientIp, createSession, destroySession } from "@/lib/auth";
import { randomToken, sha256 } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { getSettings, settingText, siteUrl } from "@/lib/settings";
import { sendEmail } from "@/lib/notifications/service";
import { emailLayout, renderTemplate, bodyToHtml } from "@/lib/notifications/render";
import { TEMPLATE_DEFAULTS } from "@/lib/notifications/registry";

const emailSchema = z.email().trim().toLowerCase().max(254);
const passwordSchema = z.string().min(12).max(200).regex(/[a-z]/i).regex(/[0-9]/, "Password must include a number.");

function safeNext(value: FormDataEntryValue | null) {
  const path = typeof value === "string" ? value : "";
  return path.startsWith("/") && !path.startsWith("//") ? path : "/account";
}

async function sendAccountEmail(key: "account.verify_email" | "account.password_reset", user: { id: string; name: string; email: string }, url: string) {
  const defaults = TEMPLATE_DEFAULTS.find((template) => template.key === key);
  const template = await prisma.notificationTemplate.findFirst({ where: { key, channel: "EMAIL" } });
  const settings = await getSettings();
  const clubName = settingText(settings, "club.name", "Chess254");
  const variables = { name: user.name, clubName, link: url };
  const subject = renderTemplate(template?.subject || defaults?.email?.subject || "Account action", variables);
  const body = renderTemplate(template?.body || defaults?.email?.body || "Open this link to continue: {{link}}", variables);
  const footer = [clubName, settingText(settings, "club.address"), settingText(settings, "club.phone"), settingText(settings, "club.contactEmail")].filter(Boolean).join(" · ");
  const html = emailLayout({ clubName, bodyHtml: bodyToHtml(renderTemplate(body, {}, true)), footer });
  const result = await sendEmail(user.email, subject, body, html, { userId: user.id, templateKey: key });
  if (!result.ok) throw new Error("Email delivery is not configured.");
}

async function issueVerificationLink(user: { id: string; name: string; email: string }) {
  const token = randomToken();
  await prisma.verificationToken.updateMany({ where: { userId: user.id, type: "EMAIL_VERIFY", usedAt: null }, data: { usedAt: new Date() } });
  await prisma.verificationToken.create({ data: { userId: user.id, type: "EMAIL_VERIFY", target: user.email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 24 * 3600_000) } });
  const url = `${siteUrl(await getSettings())}/account/verify?token=${encodeURIComponent(token)}`;
  await sendAccountEmail("account.verify_email", user, url);
}

export async function registerAction(formData: FormData) {
  const input = z.object({ name: z.string().trim().min(2).max(100), email: emailSchema, password: passwordSchema, confirmPassword: z.string().max(200) }).refine((data) => data.password === data.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." }).safeParse({ name: formData.get("name"), email: formData.get("email"), password: formData.get("password"), confirmPassword: formData.get("confirmPassword") });
  if (!input.success) redirect("/account/register?error=invalid");
  const ip = await clientIp();
  if (!(await rateLimit(`auth:register:ip:${sha256(ip)}`, 8, 3600)) || !(await rateLimit(`auth:register:email:${sha256(input.data.email)}`, 4, 3600))) redirect("/account/register?error=rate");
  const passwordHash = await bcrypt.hash(input.data.password, 12);
  let user: { id: string; name: string; email: string } | undefined;
  try {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { name: input.data.name, email: input.data.email, passwordHash, role: "MEMBER", memberProfile: { create: {} } } });
      await audit({ actorId: created.id, action: "account.registered", entity: "User", entityId: created.id, next: { email: created.email } }, tx);
      return created;
    });
  } catch {
    // Keep registration responses the same for new and already-registered addresses.
    const existing = await prisma.user.findUnique({ where: { email: input.data.email } }).catch(() => null);
    if (existing && !existing.emailVerifiedAt && !existing.suspendedAt) {
      try { await issueVerificationLink(existing); } catch { /* Keep the response identical whether an account exists or mail is down. */ }
    }
    redirect("/account/register?sent=1");
  }
  try { await issueVerificationLink(user); }
  catch { redirect("/account/register?sent=1&mail=unavailable"); }
  redirect("/account/register?sent=1");
}

export async function loginAction(formData: FormData) {
  const input = z.object({ email: emailSchema, password: z.string().min(1).max(200) }).safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!input.success) redirect("/account/login?error=credentials");
  const ip = await clientIp();
  if (!(await rateLimit(`auth:login:ip:${sha256(ip)}`, 15, 900)) || !(await rateLimit(`auth:login:email:${sha256(input.data.email)}`, 8, 900))) redirect("/account/login?error=credentials");
  const user = await prisma.user.findUnique({ where: { email: input.data.email } }).catch(() => null);
  if (!user || user.suspendedAt || !user.emailVerifiedAt || !(await bcrypt.compare(input.data.password, user.passwordHash))) redirect("/account/login?error=credentials");
  await createSession(user.id);
  redirect(safeNext(formData.get("next")));
}

export async function logoutAccountAction() {
  await destroySession();
  redirect("/account/login");
}

export async function verifyEmailAction(formData: FormData) {
  const token = z.string().min(32).max(100).safeParse(formData.get("token"));
  if (!token.success) redirect("/account/verify?result=invalid");
  const tokenHash = sha256(token.data);
  try {
    const verification = await prisma.verificationToken.findUnique({ where: { tokenHash } });
    if (!verification || verification.type !== "EMAIL_VERIFY" || verification.usedAt || verification.expiresAt < new Date()) redirect("/account/verify?result=invalid");
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.verificationToken.updateMany({ where: { id: verification.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw new Error("Verification link already used.");
      await tx.user.update({ where: { id: verification.userId }, data: { emailVerifiedAt: new Date() } });
      await tx.verificationToken.updateMany({ where: { userId: verification.userId, type: "EMAIL_VERIFY", usedAt: null }, data: { usedAt: new Date() } });
      await audit({ actorId: verification.userId, action: "account.email_verified", entity: "User", entityId: verification.userId }, tx);
    });
  } catch { redirect("/account/verify?result=invalid"); }
  redirect("/account/login?verified=1");
}

export async function requestPasswordResetAction(formData: FormData) {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) redirect("/account/forgot-password?sent=1");
  const ip = await clientIp();
  const allowed = await rateLimit(`auth:reset:ip:${sha256(ip)}`, 12, 3600) && await rateLimit(`auth:reset:email:${sha256(parsed.data)}`, 4, 3600);
  if (!allowed) redirect("/account/forgot-password?sent=1");
  const user = await prisma.user.findUnique({ where: { email: parsed.data } }).catch(() => null);
  if (user && !user.suspendedAt) {
    const token = randomToken();
    await prisma.verificationToken.create({ data: { userId: user.id, type: "PASSWORD_RESET", target: user.email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000) } }).catch(() => null);
    const url = `${siteUrl(await getSettings())}/account/reset-password?token=${encodeURIComponent(token)}`;
    try { await sendAccountEmail("account.password_reset", user, url); } catch { /* The response stays generic to prevent account enumeration. */ }
  }
  redirect("/account/forgot-password?sent=1");
}

export async function resetPasswordAction(formData: FormData) {
  const input = z.object({ token: z.string().min(32).max(100), password: passwordSchema, confirmPassword: z.string().max(200) }).refine((data) => data.password === data.confirmPassword, { path: ["confirmPassword"] }).safeParse({ token: formData.get("token"), password: formData.get("password"), confirmPassword: formData.get("confirmPassword") });
  if (!input.success) redirect("/account/reset-password?result=invalid");
  const tokenHash = sha256(input.data.token);
  const passwordHash = await bcrypt.hash(input.data.password, 12);
  try {
    await prisma.$transaction(async (tx) => {
      const token = await tx.verificationToken.findUnique({ where: { tokenHash } });
      if (!token || token.type !== "PASSWORD_RESET" || token.usedAt || token.expiresAt < new Date()) throw new Error("Reset link is invalid.");
      const claimed = await tx.verificationToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw new Error("Reset link already used.");
      await tx.user.update({ where: { id: token.userId }, data: { passwordHash } });
      await tx.verificationToken.updateMany({ where: { userId: token.userId, type: "PASSWORD_RESET", usedAt: null }, data: { usedAt: new Date() } });
      await tx.session.deleteMany({ where: { userId: token.userId } });
      await audit({ actorId: token.userId, action: "account.password_reset", entity: "User", entityId: token.userId }, tx);
    });
  } catch { redirect("/account/reset-password?result=invalid"); }
  redirect("/account/login?reset=1");
}
