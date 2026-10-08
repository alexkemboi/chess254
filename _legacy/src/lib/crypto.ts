import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Numeric one-time code with uniform distribution. */
export function randomDigits(length = 6) {
  let out = "";
  while (out.length < length) {
    const byte = randomBytes(1)[0];
    if (byte < 250) out += String(byte % 10);
  }
  return out;
}

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function requireSecret(name: string) {
  const value = process.env[name];
  if (!value || value.length < 16) throw new Error(`${name} must be configured with at least 16 characters.`);
  return value;
}

/** Stable, secret-derived token used in provider callback URLs (M-Pesa, Africa's Talking). */
export function webhookToken(purpose: string) {
  const secret = process.env.WEBHOOK_SECRET || requireSecret("AUTH_SECRET");
  return createHmac("sha256", secret).update(`webhook:${purpose}`).digest("base64url").slice(0, 32);
}

export function encryptionAvailable() {
  return Boolean(process.env.SETTINGS_ENCRYPTION_KEY && process.env.SETTINGS_ENCRYPTION_KEY.length >= 16);
}

const encryptionKey = () => createHash("sha256").update(requireSecret("SETTINGS_ENCRYPTION_KEY")).digest();

export function encrypt(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function decrypt(record: { ciphertext: string; iv: string; tag: string }) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

/** Deterministic per-order secret that lets guests view their order and receipt. */
export function orderAccessToken(orderId: string) {
  return createHmac("sha256", requireSecret("AUTH_SECRET")).update(`order:${orderId}`).digest("base64url").slice(0, 32);
}
