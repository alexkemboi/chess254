import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { getIntegrationConfig } from "@/lib/integrations";

export type SendResult = { ok: boolean; messageId?: string; status?: string; cost?: string; raw?: unknown; error?: string };

export interface SmsProvider {
  readonly key: string;
  configured(): boolean;
  send(to: string, message: string): Promise<SendResult>;
}

export interface EmailProvider {
  readonly key: string;
  configured(): boolean;
  send(message: { to: string; subject: string; html: string; text: string }): Promise<SendResult>;
}

// ─── Africa's Talking ───────────────────────────────────────────────────────

const AT_SUCCESS_CODES = new Set([100, 101, 102]);

export class AfricasTalkingSms implements SmsProvider {
  readonly key = "africastalking";
  constructor(private cfg: Record<string, string>) {}

  configured() {
    return Boolean(this.cfg.username && this.cfg.apiKey);
  }

  private baseUrl() {
    if (this.cfg.apiBaseUrl) return this.cfg.apiBaseUrl.replace(/\/+$/, "");
    return this.cfg.environment === "production" ? "https://api.africastalking.com" : "https://api.sandbox.africastalking.com";
  }

  async send(to: string, message: string): Promise<SendResult> {
    const body = new URLSearchParams({ username: this.cfg.username, to: to.startsWith("+") ? to : `+${to}`, message });
    if (this.cfg.senderId) body.set("from", this.cfg.senderId);
    try {
      const res = await fetch(`${this.baseUrl()}/version1/messaging`, {
        method: "POST",
        headers: { apiKey: this.cfg.apiKey, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      let raw: unknown = text;
      try { raw = JSON.parse(text); } catch { /* AT returns plain text on auth errors */ }
      if (!res.ok) return { ok: false, raw, error: `HTTP ${res.status}: ${typeof raw === "string" ? raw.slice(0, 200) : "request rejected"}` };
      const recipient = (raw as { SMSMessageData?: { Recipients?: { statusCode: number; status: string; messageId: string; cost: string }[]; Message?: string } })?.SMSMessageData?.Recipients?.[0];
      if (!recipient) return { ok: false, raw, error: (raw as { SMSMessageData?: { Message?: string } })?.SMSMessageData?.Message || "No recipient accepted" };
      const ok = AT_SUCCESS_CODES.has(Number(recipient.statusCode));
      return { ok, raw, messageId: recipient.messageId !== "None" ? recipient.messageId : undefined, status: recipient.status, cost: recipient.cost, error: ok ? undefined : recipient.status };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Network error" };
    }
  }
}

// ─── Gmail SMTP ─────────────────────────────────────────────────────────────

let cachedTransport: { signature: string; transport: Transporter } | null = null;

export class SmtpEmail implements EmailProvider {
  readonly key = "smtp";
  constructor(private cfg: Record<string, string>) {}

  configured() {
    return Boolean(this.cfg.host && this.cfg.user && this.cfg.password && (this.cfg.fromEmail || this.cfg.user));
  }

  private transport() {
    const signature = [this.cfg.host, this.cfg.port, this.cfg.secure, this.cfg.user, this.cfg.password].join("|");
    if (cachedTransport?.signature !== signature) {
      const port = Number(this.cfg.port) || 465;
      cachedTransport = {
        signature,
        transport: nodemailer.createTransport({
          host: this.cfg.host, port, secure: this.cfg.secure === "true" || port === 465,
          auth: { user: this.cfg.user, pass: this.cfg.password },
          connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000,
          tls: { minVersion: "TLSv1.2", rejectUnauthorized: process.env.SMTP_ALLOW_SELF_SIGNED !== "true" },
        }),
      };
    }
    return cachedTransport.transport;
  }

  async send(message: { to: string; subject: string; html: string; text: string }): Promise<SendResult> {
    const fromEmail = this.cfg.fromEmail || this.cfg.user;
    try {
      const info = await this.transport().sendMail({ from: this.cfg.fromName ? { name: this.cfg.fromName, address: fromEmail } : fromEmail, ...message });
      return { ok: info.accepted.length > 0, messageId: info.messageId, raw: { accepted: info.accepted, rejected: info.rejected, response: info.response }, error: info.accepted.length ? undefined : "Recipient rejected" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "SMTP error" };
    }
  }
}

export async function smsProvider(): Promise<SmsProvider> {
  return new AfricasTalkingSms(await getIntegrationConfig("sms"));
}

export async function emailProvider(): Promise<EmailProvider> {
  return new SmtpEmail(await getIntegrationConfig("email"));
}
