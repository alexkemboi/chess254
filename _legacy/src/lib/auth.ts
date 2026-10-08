import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { randomToken, sha256 } from "@/lib/crypto";
import { can, isStaff, type Permission } from "@/lib/rbac";

export const SESSION_COOKIE = "chess254_session";
const SESSION_DAYS = 14;

export async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "unknown").trim();
}

export async function createSession(userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const h = await headers();
  await prisma.session.create({ data: { userId, tokenHash: sha256(token), expiresAt, userAgent: h.get("user-agent")?.slice(0, 300), ipAddress: await clientIp() } });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
}

/** Resolves the signed-in user once per request. */
export const currentUser = cache(async () => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } }).catch(() => null);
  if (!session || session.expiresAt <= new Date() || session.user.suspendedAt || !session.user.emailVerifiedAt) return null;
  return session.user;
});

export async function requireUser(next = "/account") {
  const user = await currentUser();
  if (!user) redirect(`/account/login?next=${encodeURIComponent(next)}`);
  return user;
}

/** Any staff role may enter the control room; individual pages check finer permissions. */
export async function requireStaff() {
  const user = await currentUser();
  if (!user || !isStaff(user.role)) redirect("/admin/login");
  return user;
}

export async function requirePermission(permission: Permission) {
  const user = await requireStaff();
  if (!can(user.role, permission)) redirect("/admin?denied=1");
  return user;
}

/** Kept for existing callers: administrators only. */
export async function requireAdmin() {
  const user = await currentUser();
  if (!user || !["SUPER_ADMIN", "ADMIN"].includes(user.role)) redirect("/admin/login");
  return user;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

export async function destroyOtherSessions(userId: string) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  await prisma.session.deleteMany({ where: { userId, ...(token ? { NOT: { tokenHash: sha256(token) } } : {}) } });
}
