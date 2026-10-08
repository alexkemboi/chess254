import "server-only";
import { prisma } from "@/server/db";
import { MpesaPaymentProvider } from "./mpesa";
import type { PaymentProvider } from "./types";

/** Implementations available in code. Which ones are enabled is decided in the database. */
const IMPLEMENTATIONS: Record<string, () => PaymentProvider> = {
  mpesa: () => new MpesaPaymentProvider(),
};

export function providerImplementation(key: string): PaymentProvider | null {
  return IMPLEMENTATIONS[key]?.() ?? null;
}

export function implementedProviderKeys() {
  return Object.keys(IMPLEMENTATIONS);
}

/** The enabled default provider (or first enabled one) with its DB row. */
export async function activeProvider() {
  const rows = await prisma.paymentProvider.findMany({ where: { enabled: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  for (const row of rows) {
    const impl = providerImplementation(row.key);
    if (impl) return { row, impl };
  }
  return null;
}
