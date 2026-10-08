import "server-only";
import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";

export async function clientIp() {
  try {
    const h = await headers();
    return (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "unknown").trim();
  } catch {
    return "unknown";
  }
}

const SECRET_KEYS = /pass(word|key)?|secret|token|hash|consumer/i;

function scrub(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  const json = JSON.parse(JSON.stringify(value, (key, v) => (key && SECRET_KEYS.test(key) ? "[redacted]" : v)));
  return json as Prisma.InputJsonValue;
}

export async function audit(
  entry: { actorId?: string | null; action: string; entity: string; entityId?: string | null; previous?: unknown; next?: unknown },
  tx: Tx | typeof prisma = prisma,
) {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      previous: scrub(entry.previous),
      next: scrub(entry.next),
      ipAddress: await clientIp(),
    },
  });
}
