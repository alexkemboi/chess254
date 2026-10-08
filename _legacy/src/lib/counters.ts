import "server-only";
import type { Prisma } from "@prisma/client";

/** Atomically increments a named counter inside the caller's transaction. */
export async function nextCounter(tx: Prisma.TransactionClient, key: string) {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  return rows[0].value;
}

export async function nextOrderNumber(tx: Prisma.TransactionClient, prefix: string) {
  const year = new Date().getFullYear().toString().slice(-2);
  const n = await nextCounter(tx, `order:${year}`);
  return `${prefix}-${year}${String(n).padStart(5, "0")}`;
}

export async function nextInvoiceNumber(tx: Prisma.TransactionClient, prefix: string) {
  const year = new Date().getFullYear();
  const n = await nextCounter(tx, `invoice:${year}`);
  return `${prefix}-${year}-${String(n).padStart(5, "0")}`;
}
