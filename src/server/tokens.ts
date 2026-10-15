import "server-only";
import type { TokenType } from "@prisma/client";
import { prisma } from "@/server/db";
import { randomToken, sha256 } from "@/server/crypto";

/** One-time tokens (email verification, password reset, account setup). Free of request APIs so jobs can issue them. */
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

