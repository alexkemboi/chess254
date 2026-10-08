import "server-only";
import { prisma } from "@/lib/prisma";
import { decrypt, encrypt, encryptionAvailable } from "@/lib/crypto";

export type IntegrationField = {
  key: string;
  label: string;
  env: string;
  secret?: boolean;
  type?: "text" | "number" | "boolean" | "select" | "password";
  options?: string[];
  help?: string;
  default?: string;
};

export type IntegrationDefinition = { key: "mpesa" | "sms" | "email"; label: string; description: string; fields: IntegrationField[] };

export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    key: "mpesa", label: "M-Pesa Daraja", description: "STK Push collection. Orders are only marked paid after a verified callback or a Daraja status query.",
    fields: [
      { key: "mpesa.environment", label: "Environment", env: "MPESA_ENVIRONMENT", type: "select", options: ["sandbox", "production"], default: "sandbox" },
      { key: "mpesa.consumerKey", label: "Consumer key", env: "MPESA_CONSUMER_KEY", secret: true },
      { key: "mpesa.consumerSecret", label: "Consumer secret", env: "MPESA_CONSUMER_SECRET", secret: true },
      { key: "mpesa.passkey", label: "Passkey", env: "MPESA_PASSKEY", secret: true },
      { key: "mpesa.shortcode", label: "Business shortcode", env: "MPESA_SHORTCODE", help: "Paybill number, or the store/head-office number for a Till." },
      { key: "mpesa.transactionType", label: "Transaction type", env: "MPESA_TRANSACTION_TYPE", type: "select", options: ["CustomerPayBillOnline", "CustomerBuyGoodsOnline"], default: "CustomerPayBillOnline" },
      { key: "mpesa.partyB", label: "Till / Paybill receiving funds", env: "MPESA_PARTY_B", help: "Till number for Buy Goods. Leave empty to use the shortcode." },
      { key: "mpesa.callbackBaseUrl", label: "Public callback base URL", env: "MPESA_CALLBACK_URL", help: "HTTPS origin Safaricom can reach, e.g. https://chess254.co.ke" },
      { key: "mpesa.accountReference", label: "Account reference", env: "MPESA_ACCOUNT_REFERENCE", help: "Up to 12 characters. {order} is replaced with the order number.", default: "{order}" },
      { key: "mpesa.currency", label: "Currency", env: "MPESA_CURRENCY", default: "KES" },
      { key: "mpesa.verifyWithQuery", label: "Confirm callbacks with an STK status query", env: "MPESA_VERIFY_WITH_QUERY", type: "boolean", default: "true" },
      { key: "mpesa.allowedIps", label: "Allowed callback IPs", env: "MPESA_ALLOWED_IPS", help: "Optional comma-separated list. Leave empty when behind a proxy that hides caller IPs." },
      { key: "mpesa.feeFixed", label: "Customer payment fee (fixed)", env: "MPESA_FEE_FIXED", type: "number", default: "0" },
      { key: "mpesa.feePercent", label: "Customer payment fee (%)", env: "MPESA_FEE_PERCENT", type: "number", default: "0" },
      { key: "mpesa.apiBaseUrl", label: "API base URL override", env: "MPESA_API_BASE_URL", help: "Leave empty. Only for test harnesses." },
    ],
  },
  {
    key: "sms", label: "Africa's Talking SMS", description: "Transactional and campaign SMS. Delivery reports update the SMS log.",
    fields: [
      { key: "sms.environment", label: "Environment", env: "AT_ENVIRONMENT", type: "select", options: ["sandbox", "production"], default: "sandbox" },
      { key: "sms.username", label: "Username", env: "AT_USERNAME", help: "Use \"sandbox\" for the sandbox environment." },
      { key: "sms.apiKey", label: "API key", env: "AT_API_KEY", secret: true },
      { key: "sms.senderId", label: "Sender ID / shortcode", env: "AT_SENDER_ID", help: "Optional alphanumeric sender ID approved on your account." },
      { key: "sms.apiBaseUrl", label: "API base URL override", env: "AT_API_BASE_URL", help: "Leave empty. Only for test harnesses." },
    ],
  },
  {
    key: "email", label: "Gmail SMTP", description: "Transactional email through Gmail using an app password.",
    fields: [
      { key: "email.host", label: "SMTP host", env: "SMTP_HOST", default: "smtp.gmail.com" },
      { key: "email.port", label: "SMTP port", env: "SMTP_PORT", type: "number", default: "465" },
      { key: "email.secure", label: "Use TLS from the start (port 465)", env: "SMTP_SECURE", type: "boolean", default: "true" },
      { key: "email.user", label: "Username", env: "SMTP_USER" },
      { key: "email.password", label: "App password", env: "SMTP_PASSWORD", secret: true },
      { key: "email.fromName", label: "Sender name", env: "EMAIL_FROM_NAME" },
      { key: "email.fromEmail", label: "Sender email", env: "EMAIL_FROM" },
    ],
  },
];

const FIELD_INDEX = Object.fromEntries(INTEGRATIONS.flatMap((i) => i.fields.map((f) => [f.key, f]))) as Record<string, IntegrationField>;

/**
 * Integration values: environment variable first, then the encrypted store.
 * Only ever called on the server. Values never leave the server except as
 * "configured" booleans or redacted hints.
 */
export async function getIntegrationConfig(key: IntegrationDefinition["key"]) {
  const def = INTEGRATIONS.find((i) => i.key === key)!;
  const rows = await prisma.integrationSecret.findMany({ where: { key: { in: def.fields.map((f) => f.key) } } });
  const stored = new Map(rows.map((r) => [r.key, r]));
  const out: Record<string, string> = {};
  for (const field of def.fields) {
    const envValue = process.env[field.env];
    if (envValue !== undefined && envValue !== "") { out[field.key.split(".")[1]] = envValue; continue; }
    const row = stored.get(field.key);
    if (row && encryptionAvailable()) {
      try { out[field.key.split(".")[1]] = decrypt(row); continue; } catch { /* key rotated: treat as unset */ }
    }
    out[field.key.split(".")[1]] = field.default ?? "";
  }
  return out;
}

export type FieldStatus = { key: string; source: "env" | "stored" | "default" | "unset"; hint?: string; value?: string };

/** Admin-safe view: secrets are reduced to a hint, plain values are shown. */
export async function describeIntegration(key: IntegrationDefinition["key"]): Promise<FieldStatus[]> {
  const def = INTEGRATIONS.find((i) => i.key === key)!;
  const rows = await prisma.integrationSecret.findMany({ where: { key: { in: def.fields.map((f) => f.key) } } });
  const stored = new Map(rows.map((r) => [r.key, r]));
  return def.fields.map((field) => {
    const envValue = process.env[field.env];
    if (envValue) return { key: field.key, source: "env", hint: field.secret ? redact(envValue) : undefined, value: field.secret ? undefined : envValue };
    const row = stored.get(field.key);
    if (row) {
      let value: string | undefined;
      if (!field.secret && encryptionAvailable()) { try { value = decrypt(row); } catch { value = undefined; } }
      return { key: field.key, source: "stored", hint: row.hint ?? undefined, value };
    }
    return { key: field.key, source: field.default ? "default" : "unset", value: field.default };
  });
}

export function redact(value: string) {
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

export async function saveIntegrationValues(values: Record<string, string | undefined>, actorId: string) {
  if (!encryptionAvailable()) throw new Error("SETTINGS_ENCRYPTION_KEY is not configured, so credentials cannot be stored. Set them as environment variables instead.");
  for (const [key, raw] of Object.entries(values)) {
    const field = FIELD_INDEX[key];
    if (!field || raw === undefined) continue;
    if (process.env[field.env]) continue; // locked by environment
    const value = raw.trim();
    if (field.secret && value === "") continue; // blank secret input means "keep current"
    if (value === "") { await prisma.integrationSecret.deleteMany({ where: { key } }); continue; }
    const sealed = encrypt(value);
    const hint = field.secret ? redact(value) : null;
    await prisma.integrationSecret.upsert({ where: { key }, create: { key, ...sealed, hint, updatedById: actorId }, update: { ...sealed, hint, updatedById: actorId } });
  }
}

export async function clearIntegrationSecret(key: string) {
  if (!FIELD_INDEX[key]?.secret) return;
  await prisma.integrationSecret.deleteMany({ where: { key } });
}
