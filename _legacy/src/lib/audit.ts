import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { clientIp } from "@/lib/auth";

type Client = Prisma.TransactionClient | typeof prisma;

export function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? `[${v.length} bytes]` : v)));
}

export async function audit(entry: { actorId?: string | null; action: string; entity: string; entityId?: string | null; previous?: unknown; next?: unknown }, client: Client = prisma) {
  let ipAddress: string | undefined;
  try { ipAddress = await clientIp(); } catch { ipAddress = undefined; }
  await client.auditLog.create({ data: { actorId: entry.actorId ?? null, action: entry.action, entity: entry.entity, entityId: entry.entityId ?? null, previous: toJson(entry.previous), next: toJson(entry.next), ipAddress } });
}
