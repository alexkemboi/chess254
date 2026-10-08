import "server-only";
import nodemailer from "nodemailer";
import type { NotificationChannel } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import { getAllSettings, siteUrl } from "@/server/settings";
import { getSecrets } from "@/server/secrets";

/**
 * In-app notifications with pluggable outbound channels. Email ships today;
 * SMS (or WhatsApp) can be added by registering another ChannelProvider.
 */
export type NotificationType =
  | "REGISTRATION"
  | "EMAIL_VERIFICATION"
  | "MEMBERSHIP_ACTIVATED"
  | "MEMBERSHIP_EXPIRING"
  | "MEMBERSHIP_EXPIRED"
  | "BOOKING_CONFIRMED"
  | "BOOKING_CANCELLED"
  | "BOOKING_REMINDER"
  | "BOOKING_RESCHEDULED"
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_FAILED"
  | "EVENT_REGISTERED"
  | "COACH_ASSIGNED"
  | "LEARNING_ASSIGNED"
  | "ASSIGNMENT_REVIEWED"
  | "COMMUNITY_REPLY"
  | "ANNOUNCEMENT"
  | "ADMIN_ALERT";

export type OutboundMessage = { to: string; subject: string; text: string; html?: string };

export interface ChannelProvider {
  channel: NotificationChannel;
  name: string;
  isConfigured(): Promise<boolean>;
  send(message: OutboundMessage): Promise<{ ok: true } | { ok: false; error: string }>;
}

class SmtpEmailProvider implements ChannelProvider {
  channel = "EMAIL" as const;
  name = "smtp";

  private async config() {
    const s = await getSecrets(["smtp.host", "smtp.port", "smtp.user", "smtp.password"]);
    return s;
  }

  async isConfigured() {
    const c = await this.config();
    return Boolean(c["smtp.host"] && c["smtp.user"] && c["smtp.password"]);
  }

  async send(message: OutboundMessage) {
    const c = await this.config();
    const settings = await getAllSettings();
    const port = Number(c["smtp.port"] || 465);
    const transport = nodemailer.createTransport({
      host: c["smtp.host"]!,
      port,
      secure: port === 465,
      auth: { user: c["smtp.user"]!, pass: c["smtp.password"]! },
    });
    const fromEmail = settings.email.fromEmail || c["smtp.user"]!;
    try {
      await transport.sendMail({
        from: settings.email.fromName ? `"${settings.email.fromName}" <${fromEmail}>` : fromEmail,
        replyTo: settings.email.replyTo || undefined,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message.slice(0, 300) : "SMTP error" };
    }
  }
}

const providers: ChannelProvider[] = [new SmtpEmailProvider()];

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function renderEmail(title: string, body: string, link?: string | null) {
  const settings = await getAllSettings();
  const base = await siteUrl();
  const url = link ? (link.startsWith("http") ? link : `${base}${link}`) : null;
  const brand = settings.brand.primaryColor;
  const name = settings.general.siteName;
  const text = `${title}\n\n${body}${url ? `\n\n${url}` : ""}\n\n— ${name}`;
  const html = `<div style="background:#050505;padding:32px;font-family:Arial,sans-serif;color:#f4f4f5">
<div style="max-width:520px;margin:auto;background:#0e1012;border:1px solid #23262a;border-radius:16px;padding:28px">
<p style="margin:0 0 18px;font-weight:800;letter-spacing:.5px">${escapeHtml(name)}</p>
<h1 style="font-size:22px;margin:0 0 12px">${escapeHtml(title)}</h1>
<p style="color:#b4b8bd;line-height:1.6;white-space:pre-line">${escapeHtml(body)}</p>
${url ? `<p style="margin-top:24px"><a href="${escapeHtml(url)}" style="background:${brand};color:#000;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:700">Open</a></p>` : ""}
</div></div>`;
  return { text, html };
}

/** Sends (or records why it could not send) an outbound message. Never throws. */
export async function deliver(channel: NotificationChannel, message: OutboundMessage, notificationId?: string) {
  const provider = providers.find((p) => p.channel === channel);
  const record = await prisma.notificationDelivery.create({
    data: { notificationId, channel, recipient: message.to, subject: message.subject, provider: provider?.name },
  });
  if (!provider || !(await provider.isConfigured())) {
    if (process.env.NODE_ENV !== "production") console.info(`[${channel.toLowerCase()}:dev] to=${message.to}\n${message.text}\n`);
    await prisma.notificationDelivery.update({ where: { id: record.id }, data: { status: "SKIPPED", error: "Provider not configured" } });
    return false;
  }
  const result = await provider.send(message);
  await prisma.notificationDelivery.update({
    where: { id: record.id },
    data: result.ok ? { status: "SENT", sentAt: new Date() } : { status: "FAILED", error: result.error },
  });
  return result.ok;
}

export async function sendEmail(to: string, title: string, body: string, link?: string | null) {
  const settings = await getAllSettings();
  if (!settings.notifications.emailEnabled) return false;
  const { text, html } = await renderEmail(title, body, link);
  return deliver("EMAIL", { to, subject: title, text, html });
}

type NotifyInput = { userId: string; type: NotificationType; title: string; body: string; link?: string; email?: boolean };

/** Creates the in-app notification inside the caller's transaction. Email is sent after commit via `dispatchEmails`. */
export async function notify(input: NotifyInput, tx: Tx | typeof prisma = prisma) {
  return tx.notification.create({ data: { userId: input.userId, type: input.type, title: input.title, body: input.body, link: input.link } });
}

/** Creates the notification and emails it (outside any transaction). */
export async function notifyAndEmail(input: NotifyInput) {
  const notification = await notify(input);
  if (input.email !== false) {
    const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { email: true } });
    const settings = await getAllSettings();
    if (user && settings.notifications.emailEnabled) {
      const { text, html } = await renderEmail(input.title, input.body, input.link);
      await deliver("EMAIL", { to: user.email, subject: input.title, text, html }, notification.id);
    }
  }
  return notification;
}

/** Emails notifications that were created inside a committed transaction. */
export async function emailNotifications(ids: string[]) {
  const settings = await getAllSettings();
  if (!settings.notifications.emailEnabled || ids.length === 0) return;
  const rows = await prisma.notification.findMany({ where: { id: { in: ids } }, include: { user: { select: { email: true } } } });
  for (const n of rows) {
    const { text, html } = await renderEmail(n.title, n.body, n.link);
    await deliver("EMAIL", { to: n.user.email, subject: n.title, text, html }, n.id);
  }
}

/** Alerts staff holding a permission (e.g. a payment that needs a refund). */
export async function alertAdmins(title: string, body: string, link?: string) {
  const admins = await prisma.user.findMany({ where: { role: { in: ["SUPER_ADMIN", "ADMIN"] }, suspendedAt: null, deletedAt: null }, select: { id: true } });
  const ids: string[] = [];
  for (const admin of admins) ids.push((await notify({ userId: admin.id, type: "ADMIN_ALERT", title, body, link })).id);
  const settings = await getAllSettings();
  if (settings.notifications.adminAlertEmail) await sendEmail(settings.notifications.adminAlertEmail, title, body, link);
  return ids;
}
