import "server-only";
import { prisma } from "@/server/db";
import { getSecrets } from "@/server/secrets";
import { webhookToken } from "@/server/crypto";
import { siteUrl } from "@/server/settings";
import { zonedParts } from "@/lib/time";
import type { InitiateInput, InitiateResult, ParsedCallback, PaymentProvider, ProviderOutcome, ProviderReadiness } from "./types";

/** Daraja protocol constants (not business data). */
const DARAJA_HOSTS = { sandbox: "https://sandbox.safaricom.co.ke", production: "https://api.safaricom.co.ke" } as const;
const DARAJA_TIMEZONE = "Africa/Nairobi"; // Daraja timestamps are East Africa Time
const CANCELLED_CODES = new Set(["1032"]); // request cancelled by user
const STILL_PROCESSING = /being processed|500\.001\.1001/i;

export const MPESA_PROVIDER_KEY = "mpesa";

type TokenCache = { token: string; expiresAt: number; cacheKey: string };
let tokenCache: TokenCache | null = null;

export async function mpesaConfig() {
  const provider = await prisma.paymentProvider.findUnique({ where: { key: MPESA_PROVIDER_KEY }, include: { config: true } });
  return { provider, config: provider?.config ?? null };
}

export function mpesaCallbackPath() {
  return `/api/payments/mpesa/callback/${webhookToken("mpesa")}`;
}

export class MpesaPaymentProvider implements PaymentProvider {
  readonly key = MPESA_PROVIDER_KEY;
  readonly displayName = "M-Pesa";

  private async context() {
    const { config } = await mpesaConfig();
    const secrets = await getSecrets(["mpesa.consumerKey", "mpesa.consumerSecret", "mpesa.passkey"]);
    const environment = (process.env.MPESA_ENVIRONMENT || config?.environment || "sandbox") as keyof typeof DARAJA_HOSTS;
    const shortcode = process.env.MPESA_SHORTCODE || config?.shortcode || "";
    const transactionType = config?.transactionType || "CustomerPayBillOnline";
    const partyB = transactionType === "CustomerBuyGoodsOnline" ? config?.tillNumber || shortcode : config?.paybillNumber || shortcode;
    const callbackBase = (process.env.MPESA_CALLBACK_URL || config?.callbackUrl || (await siteUrl())).replace(/\/+$/, "");
    const baseUrl = (process.env.MPESA_API_BASE_URL || DARAJA_HOSTS[environment] || DARAJA_HOSTS.sandbox).replace(/\/+$/, "");
    return {
      config,
      environment,
      shortcode,
      partyB,
      transactionType,
      callbackUrl: `${callbackBase}${mpesaCallbackPath()}`,
      baseUrl,
      consumerKey: secrets["mpesa.consumerKey"],
      consumerSecret: secrets["mpesa.consumerSecret"],
      passkey: secrets["mpesa.passkey"],
    };
  }

  async readiness(): Promise<ProviderReadiness> {
    const c = await this.context();
    const missing: string[] = [];
    if (!c.consumerKey) missing.push("Consumer key");
    if (!c.consumerSecret) missing.push("Consumer secret");
    if (!c.passkey) missing.push("Passkey");
    if (!c.shortcode) missing.push("Shortcode");
    if (c.transactionType === "CustomerBuyGoodsOnline" && !c.partyB) missing.push("Till number");
    if (c.environment === "production" && !c.callbackUrl.startsWith("https://")) missing.push("HTTPS callback URL");
    return { ready: missing.length === 0, missing, environment: c.environment };
  }

  normalizePhone(input: string) {
    const digits = input.replace(/[\s()+-]/g, "");
    let msisdn: string | null = null;
    if (/^0[17]\d{8}$/.test(digits)) msisdn = `254${digits.slice(1)}`;
    else if (/^[17]\d{8}$/.test(digits)) msisdn = `254${digits}`;
    else if (/^254[17]\d{8}$/.test(digits)) msisdn = digits;
    return msisdn;
  }

  async formatAccountReference(orderNumber: string) {
    const { config } = await mpesaConfig();
    const format = config?.accountReferenceFormat || "{order}";
    // Daraja limits AccountReference to 12 characters.
    return format.replace("{order}", orderNumber).replace(/[^A-Za-z0-9-]/g, "").slice(0, 12) || orderNumber.slice(0, 12);
  }

  private timestamp() {
    const p = zonedParts(new Date(), DARAJA_TIMEZONE);
    const now = new Date();
    const seconds = String(now.getUTCSeconds()).padStart(2, "0");
    return `${p.year}${String(p.month).padStart(2, "0")}${String(p.day).padStart(2, "0")}${String(p.hour).padStart(2, "0")}${String(p.minute).padStart(2, "0")}${seconds}`;
  }

  private async accessToken(c: Awaited<ReturnType<MpesaPaymentProvider["context"]>>) {
    const cacheKey = `${c.baseUrl}|${c.consumerKey}`;
    if (tokenCache && tokenCache.cacheKey === cacheKey && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token;
    const auth = Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString("base64");
    const res = await fetch(`${c.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${auth}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`M-Pesa authentication failed (${res.status})`);
    const body = (await res.json()) as { access_token?: string; expires_in?: string | number };
    if (!body.access_token) throw new Error("M-Pesa authentication returned no token");
    tokenCache = { token: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3599) * 1000, cacheKey };
    return body.access_token;
  }

  private async post(path: string, payload: unknown) {
    const c = await this.context();
    const token = await this.accessToken(c);
    const res = await fetch(`${c.baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    return { status: res.status, body };
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const c = await this.context();
    const readiness = await this.readiness();
    if (!readiness.ready) return { ok: false, message: "M-Pesa is not fully configured.", raw: { missing: readiness.missing } };
    const timestamp = this.timestamp();
    const password = Buffer.from(`${c.shortcode}${c.passkey}${timestamp}`).toString("base64");
    const payload = {
      BusinessShortCode: c.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: c.transactionType,
      Amount: Math.ceil(input.amount),
      PartyA: input.phone,
      PartyB: c.partyB,
      PhoneNumber: input.phone,
      CallBackURL: c.callbackUrl,
      AccountReference: input.accountReference,
      TransactionDesc: input.description.replace(/[^A-Za-z0-9 ]/g, "").slice(0, 13) || "Payment",
    };
    try {
      const { body } = await this.post("/mpesa/stkpush/v1/processrequest", payload);
      const { Password: _omit, ...safeRequest } = payload;
      void _omit;
      if (String(body.ResponseCode) === "0" && typeof body.CheckoutRequestID === "string") {
        return {
          ok: true,
          checkoutRequestId: body.CheckoutRequestID,
          merchantRequestId: typeof body.MerchantRequestID === "string" ? body.MerchantRequestID : undefined,
          customerMessage: typeof body.CustomerMessage === "string" ? body.CustomerMessage : undefined,
          raw: { request: safeRequest, response: body },
        };
      }
      const message = String(body.errorMessage ?? body.ResponseDescription ?? "M-Pesa could not start the payment.");
      return { ok: false, message, raw: { request: safeRequest, response: body } };
    } catch (error) {
      return { ok: false, message: "We could not reach M-Pesa. Please try again.", raw: { error: error instanceof Error ? error.message : String(error) } };
    }
  }

  async query(checkoutRequestId: string): Promise<ProviderOutcome> {
    const c = await this.context();
    const timestamp = this.timestamp();
    const password = Buffer.from(`${c.shortcode}${c.passkey}${timestamp}`).toString("base64");
    try {
      const { body } = await this.post("/mpesa/stkpushquery/v1/query", {
        BusinessShortCode: c.shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      });
      const errorMessage = typeof body.errorMessage === "string" ? body.errorMessage : "";
      if (errorMessage && STILL_PROCESSING.test(`${body.errorCode} ${errorMessage}`)) {
        return { status: "PENDING", message: errorMessage, raw: body };
      }
      if (body.ResultCode === undefined || body.ResultCode === null) {
        return { status: "PENDING", message: errorMessage || "Status not yet available", raw: body };
      }
      const code = String(body.ResultCode);
      const message = String(body.ResultDesc ?? "");
      if (code === "0") return { status: "SUCCESS", resultCode: code, message, raw: body };
      return { status: CANCELLED_CODES.has(code) ? "CANCELLED" : "FAILED", resultCode: code, message, raw: body };
    } catch (error) {
      return { status: "PENDING", message: "Status query failed", raw: { error: error instanceof Error ? error.message : String(error) } };
    }
  }

  parseCallback(body: unknown): ParsedCallback | null {
    const cb = (body as { Body?: { stkCallback?: Record<string, unknown> } })?.Body?.stkCallback;
    if (!cb || typeof cb.CheckoutRequestID !== "string" || cb.ResultCode === undefined) return null;
    const code = String(cb.ResultCode);
    const items = ((cb.CallbackMetadata as { Item?: { Name: string; Value?: unknown }[] })?.Item ?? []).reduce<Record<string, unknown>>(
      (acc, item) => ({ ...acc, [item.Name]: item.Value }),
      {},
    );
    const outcome: ProviderOutcome = {
      status: code === "0" ? "SUCCESS" : CANCELLED_CODES.has(code) ? "CANCELLED" : "FAILED",
      resultCode: code,
      message: typeof cb.ResultDesc === "string" ? cb.ResultDesc : undefined,
      receiptNumber: typeof items.MpesaReceiptNumber === "string" ? items.MpesaReceiptNumber : undefined,
      amount: items.Amount !== undefined ? Number(items.Amount) : undefined,
      phone: items.PhoneNumber !== undefined ? String(items.PhoneNumber) : undefined,
      transactionDate: items.TransactionDate !== undefined ? String(items.TransactionDate) : undefined,
      raw: body,
    };
    return {
      eventKey: `mpesa:${cb.CheckoutRequestID}:${code}`,
      checkoutRequestId: cb.CheckoutRequestID,
      merchantRequestId: typeof cb.MerchantRequestID === "string" ? cb.MerchantRequestID : undefined,
      outcome,
    };
  }
}
