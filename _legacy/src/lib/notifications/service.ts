import "server-only";
import type { NotificationChannel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toJson } from "@/lib/audit";
import { getSettings, settingBool, settingText, siteUrl } from "@/lib/settings";
import { normalizeKenyanPhone } from "@/lib/format";
import { emailProvider, smsProvider } from "@/lib/notifications/providers";
import { bodyToHtml, emailLayout, renderTemplate, type TemplateVars } from "@/lib/notifications/render";
import type { NotificationKey } from "@/lib/notifications/registry";

type Meta = { userId?: string | null; orderId?: string | null; templateKey?: string | null };

export async function sendSms(to: string, message: string, meta: Meta = {}) {
  const provider = await smsProvider();
  const phone = normalizeKenyanPhone(to) ?? to;
  const log = await prisma.sMSLog.create({ data: { to: phone, message, templateKey: meta.templateKey ?? null, provider: provider.key, userId: meta.userId ?? null, orderId: meta.orderId ?? null } });
  if (!provider.configured()) {
    await prisma.sMSLog.update({ where: { id: log.id }, data: { status: "SKIPPED", error: "Africa's Talking is not configured" } });
    return { ok: false, logId: log.id, error: "SMS provider not configured" };
  }
  const result = await provider.send(phone, message);
  await prisma.sMSLog.update({
    where: { id: log.id },
    data: {
      status: result.ok ? "SENT" : "FAILED", providerMessageId: result.messageId ?? null, providerStatus: result.status ?? null,
      providerResponse: toJson(result.raw), cost: result.cost ?? null, error: result.error ?? null, sentAt: result.ok ? new Date() : null,
    },
  }).catch(async () => {
    // providerMessageId is unique; never let a duplicate id lose the log entry.
    await prisma.sMSLog.update({ where: { id: log.id }, data: { status: result.ok ? "SENT" : "FAILED", providerStatus: result.status ?? null, providerResponse: toJson(result.raw), error: result.error ?? null } });
  });
  return { ok: result.ok, logId: log.id, error: result.error };
}

export async function sendEmail(to: string, subject: string, text: string, html: string, meta: Meta = {}) {
  const provider = await emailProvider();
  const log = await prisma.emailLog.create({ data: { to, subject, templateKey: meta.templateKey ?? null, provider: provider.key, userId: meta.userId ?? null, orderId: meta.orderId ?? null } });
  if (!provider.configured()) {
    await prisma.emailLog.update({ where: { id: log.id }, data: { status: "SKIPPED", error: "SMTP is not configured" } });
    return { ok: false, logId: log.id, error: "Email provider not configured" };
  }
  const result = await provider.send({ to, subject, html, text });
  await prisma.emailLog.update({ where: { id: log.id }, data: { status: result.ok ? "SENT" : "FAILED", providerMessageId: result.messageId ?? null, providerResponse: toJson(result.raw), error: result.error ?? null, sentAt: result.ok ? new Date() : null } });
  return { ok: result.ok, logId: log.id, error: result.error };
}

/** Wraps arbitrary staff-written text in the branded email layout. */
export async function brandedEmail(bodyText: string, vars: TemplateVars = {}) {
  const settings = await getSettings();
  const clubName = settingText(settings, "club.name", "Chess254");
  const footer = [clubName, settingText(settings, "club.address"), settingText(settings, "club.phone"), settingText(settings, "club.contactEmail")].filter(Boolean).join(" · ");
  const rendered = renderTemplate(bodyText, { clubName, ...vars }, true);
  return { html: emailLayout({ clubName, bodyHtml: bodyToHtml(rendered), footer }), text: renderTemplate(bodyText, { clubName, ...vars }) };
}

export type NotifyTarget = { userId?: string | null; phone?: string | null; email?: string | null; orderId?: string | null; link?: string | null; channels?: NotificationChannel[] };

/**
 * Sends a templated notification on every enabled channel. Failures are logged,
 * never thrown, so a provider outage can't break payment or order flows.
 */
export async function notify(key: NotificationKey, target: NotifyTarget, vars: TemplateVars) {
  try {
    const settings = await getSettings();
    const clubName = settingText(settings, "club.name", "Chess254");
    const allVars: TemplateVars = { clubName, ...vars };
    const templates = await prisma.notificationTemplate.findMany({ where: { key, enabled: true } });
    const wanted = (channel: NotificationChannel) => !target.channels || target.channels.includes(channel);
    let inAppBody: string | null = null;
    let inAppTitle: string | null = null;

    const sms = templates.find((t) => t.channel === "SMS");
    if (sms && wanted("SMS") && target.phone && settingBool(settings, "notifications.smsEnabled")) {
      const text = renderTemplate(sms.body, allVars).slice(0, 918);
      inAppBody = text; inAppTitle = sms.name;
      await sendSms(target.phone, text, { userId: target.userId, orderId: target.orderId, templateKey: key });
    }

    const email = templates.find((t) => t.channel === "EMAIL");
    if (email && wanted("EMAIL") && target.email && settingBool(settings, "notifications.emailEnabled")) {
      const subject = renderTemplate(email.subject ?? email.name, allVars);
      const { html, text } = await brandedEmail(email.body, allVars);
      inAppTitle = subject; inAppBody = inAppBody ?? text.replace(/\n{2,}/g, "\n").slice(0, 600);
      await sendEmail(target.email, subject, text, html, { userId: target.userId, orderId: target.orderId, templateKey: key });
    }

    if (target.userId && inAppTitle && !key.startsWith("admin.") && key !== "account.phone_otp") {
      await prisma.notification.create({ data: { userId: target.userId, type: key, title: inAppTitle, body: inAppBody ?? "", link: target.link ?? null } });
    }
  } catch (error) {
    console.error(`[notify] ${key} failed`, error);
  }
}

export async function notifyStaff(key: NotificationKey, vars: TemplateVars, orderId?: string) {
  const settings = await getSettings();
  await notify(key, { phone: settingText(settings, "notifications.adminPhone") || null, email: settingText(settings, "notifications.adminEmail") || null, orderId }, { ...vars, link: vars.link ?? `${siteUrl(settings)}/admin` });
}
