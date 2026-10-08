import "server-only";
import { prisma } from "@/server/db";
import { decrypt, encrypt, encryptionAvailable } from "@/server/crypto";
import { UserError } from "@/server/errors";

/**
 * Credential registry. Resolution order: environment variable → encrypted
 * IntegrationSecret row. Values never leave the server; admin screens only see
 * where a value comes from and a redacted hint.
 */
export const SECRET_DEFINITIONS = {
  "mpesa.consumerKey": { label: "Consumer key", env: "MPESA_CONSUMER_KEY", group: "mpesa" },
  "mpesa.consumerSecret": { label: "Consumer secret", env: "MPESA_CONSUMER_SECRET", group: "mpesa" },
  "mpesa.passkey": { label: "Lipa na M-Pesa passkey", env: "MPESA_PASSKEY", group: "mpesa" },
  "smtp.host": { label: "SMTP host", env: "SMTP_HOST", group: "email" },
  "smtp.port": { label: "SMTP port", env: "SMTP_PORT", group: "email" },
  "smtp.user": { label: "SMTP username", env: "SMTP_USER", group: "email" },
  "smtp.password": { label: "SMTP password", env: "SMTP_PASSWORD", group: "email" },
} as const;

export type SecretKey = keyof typeof SECRET_DEFINITIONS;

export async function getSecret(key: SecretKey): Promise<string | null> {
  const envValue = process.env[SECRET_DEFINITIONS[key].env];
  if (envValue) return envValue;
  if (!encryptionAvailable()) return null;
  const row = await prisma.integrationSecret.findUnique({ where: { key } });
  if (!row) return null;
  try {
    return decrypt(row);
  } catch {
    return null; // encryption key rotated: treat as unset
  }
}

export async function getSecrets<K extends SecretKey>(keys: K[]) {
  const entries = await Promise.all(keys.map(async (k) => [k, await getSecret(k)] as const));
  return Object.fromEntries(entries) as Record<K, string | null>;
}

export type SecretStatus = { key: SecretKey; label: string; source: "env" | "stored" | "unset"; hint: string | null };

export async function describeSecrets(group: "mpesa" | "email"): Promise<SecretStatus[]> {
  const keys = (Object.keys(SECRET_DEFINITIONS) as SecretKey[]).filter((k) => SECRET_DEFINITIONS[k].group === group);
  const rows = await prisma.integrationSecret.findMany({ where: { key: { in: keys } }, select: { key: true, hint: true } });
  const stored = new Map(rows.map((r) => [r.key, r.hint]));
  return keys.map((key) => {
    const def = SECRET_DEFINITIONS[key];
    if (process.env[def.env]) return { key, label: def.label, source: "env", hint: redact(process.env[def.env]!) };
    if (stored.has(key)) return { key, label: def.label, source: "stored", hint: stored.get(key) ?? null };
    return { key, label: def.label, source: "unset", hint: null };
  });
}

function redact(value: string) {
  return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
}

/** Write-only update. Blank values are ignored; env-provided keys cannot be overridden. */
export async function storeSecrets(values: Partial<Record<SecretKey, string>>, actorId: string) {
  const changed: SecretKey[] = [];
  for (const [key, raw] of Object.entries(values) as [SecretKey, string | undefined][]) {
    const value = raw?.trim();
    if (!value || !(key in SECRET_DEFINITIONS)) continue;
    if (process.env[SECRET_DEFINITIONS[key].env]) throw new UserError(`${SECRET_DEFINITIONS[key].label} is set by the server environment and cannot be changed here.`);
    if (!encryptionAvailable()) throw new UserError("SETTINGS_ENCRYPTION_KEY is not configured, so credentials cannot be stored. Set them as environment variables instead.");
    const sealed = encrypt(value);
    await prisma.integrationSecret.upsert({
      where: { key },
      create: { key, ...sealed, hint: redact(value), updatedById: actorId },
      update: { ...sealed, hint: redact(value), updatedById: actorId },
    });
    changed.push(key);
  }
  return changed;
}

export async function clearSecret(key: SecretKey) {
  await prisma.integrationSecret.deleteMany({ where: { key } });
}
