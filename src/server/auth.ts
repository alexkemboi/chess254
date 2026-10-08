import "server-only";
import { cache } from "react";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { TokenType, User } from "@prisma/client";
import { prisma } from "@/server/db";
import { randomToken, sha256 } from "@/server/crypto";
import { clientIp } from "@/server/audit";
import { can, type Permission } from "@/server/rbac";
import { UserError } from "@/server/errors";

export const SESSION_COOKIE = "c254_session";
const SESSION_DAYS = 14;
const BCRYPT_ROUNDS = 12;

export type SessionUser = Pick<User, "id" | "email" | "name" | "role" | "phone" | "emailVerifiedAt">;

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

/** A real hash so failed lookups take as long as real ones (no user enumeration by timing). */
let dummyHash: Promise<string> | null = null;
export async function verifyPasswordOrDummy(password: string, hash: string | undefined) {
  dummyHash ??= bcrypt.hash(randomToken(), BCRYPT_ROUNDS);
  const ok = await bcrypt.compare(password, hash ?? (await dummyHash));
  return Boolean(hash) && ok;
}

export async function createSession(userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  const h = await headers();
  await prisma.session.create({
    data: { userId, tokenHash: sha256(token), expiresAt, userAgent: h.get("user-agent")?.slice(0, 300), ipAddress: await clientIp() },
  });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
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

/** Resolves the signed-in user once per request. Suspended, deleted and unverified users have no session. */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session
    .findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { select: { id: true, email: true, name: true, role: true, phone: true, emailVerifiedAt: true, suspendedAt: true, deletedAt: true } } },
    })
    .catch(() => null);
  if (!session || session.expiresAt <= new Date()) return null;
  const { user } = session;
  if (user.suspendedAt || user.deletedAt || !user.emailVerifiedAt) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role, phone: user.phone, emailVerifiedAt: user.emailVerifiedAt };
});

export async function requireUser(next?: string) {
  const user = await currentUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}

/** For pages: redirects when the permission is missing. */
export async function requirePermission(permission: Permission, next?: string) {
  const user = await requireUser(next);
  if (!(await can(user.role, permission))) redirect("/forbidden");
  return user;
}

/** For Server Actions and route handlers: throws a user-safe error instead of redirecting. */
export async function assertUser() {
  const user = await currentUser();
  if (!user) throw new UserError("Please sign in to continue.");
  return user;
}

export async function assertPermission(permission: Permission) {
  const user = await assertUser();
  if (!(await can(user.role, permission))) throw new UserError("You do not have permission to do that.");
  return user;
}

// ─── One-time tokens (email verification, password reset) ─────────────────

export async function issueToken(userId: string, type: TokenType, ttlMinutes: number) {
  const token = randomToken();
  await prisma.verificationToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
  await prisma.verificationToken.create({
    data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMinutes * 60_000) },
  });
  return token;
}

/** Atomically consumes a token; returns the user id or null if invalid, used or expired. */
export async function consumeToken(token: string, type: TokenType) {
  const record = await prisma.verificationToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.type !== type || record.usedAt || record.expiresAt <= new Date()) return null;
  const { count } = await prisma.verificationToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
  return count === 1 ? record.userId : null;
}

export const passwordPolicy = {
  min: 10,
  message: "Use at least 10 characters with letters and numbers.",
  test: (value: string) => value.length >= 10 && /[a-zA-Z]/.test(value) && /\d/.test(value),
};
