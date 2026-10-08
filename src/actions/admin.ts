"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { prisma } from "@/server/db";
import { assertPermission } from "@/server/auth";
import { runAction, parseForm, UserError, type ActionResult } from "@/server/errors";
import { audit } from "@/server/audit";
import { can, PERMISSIONS } from "@/server/rbac";
import { cancelBooking, rescheduleBooking } from "@/server/booking";
import { cancelRegistration } from "@/server/events";
import { reconcilePayment, settleManually } from "@/server/payments/service";
import { providerImplementation } from "@/server/payments/registry";
import { emailNotifications, notify } from "@/server/notifications";
import { addBillingPeriod } from "@/server/orders";
import { activeMembershipWhere } from "@/server/memberships";
import { refreshPostCounters } from "@/server/community";
import { SETTINGS_SCHEMAS, saveSettings, getAllSettings, type SettingsGroup } from "@/server/settings";
import { storeSecrets, clearSecret, SECRET_DEFINITIONS, type SecretKey } from "@/server/secrets";
import { zonedTimeToUtc, isValidClock, minutesOf } from "@/lib/time";

const id = z.string().min(1).max(40);
const ROLE_VALUES = ["SUPER_ADMIN", "ADMIN", "COACH", "MODERATOR", "MEMBER"] as const;

// ─── Users ────────────────────────────────────────────────────────────────

export async function changeRoleAction(userId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("roles.manage");
    const { role } = parseForm(z.object({ role: z.enum(ROLE_VALUES) }), formData);
    const user = await prisma.user.findUnique({ where: { id: id.parse(userId) } });
    if (!user) throw new UserError("User not found.");
    if (user.id === actor.id && role !== actor.role) throw new UserError("You can't change your own role.");
    if (user.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN" && (await prisma.user.count({ where: { role: "SUPER_ADMIN", suspendedAt: null } })) <= 1) throw new UserError("At least one super admin must remain.");
    await prisma.user.update({ where: { id: user.id }, data: { role } });
    await audit({ actorId: actor.id, action: "user.role_change", entity: "User", entityId: user.id, previous: { role: user.role }, next: { role } });
    return { ok: true, message: `Role changed to ${role.toLowerCase().replace("_", " ")}.` };
  });
}

export async function suspendUserAction(userId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("users.manage");
    const data = parseForm(z.object({ suspend: z.enum(["true", "false"]), reason: z.string().trim().max(300).optional() }), formData);
    const user = await prisma.user.findUnique({ where: { id: id.parse(userId) } });
    if (!user) throw new UserError("User not found.");
    if (user.id === actor.id) throw new UserError("You can't suspend yourself.");
    if (user.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") throw new UserError("Only a super admin can suspend a super admin.");
    const suspend = data.suspend === "true";
    await prisma.user.update({ where: { id: user.id }, data: { suspendedAt: suspend ? new Date() : null, suspensionReason: suspend ? data.reason || null : null } });
    if (suspend) await prisma.session.deleteMany({ where: { userId: user.id } });
    await audit({ actorId: actor.id, action: suspend ? "user.suspend" : "user.unsuspend", entity: "User", entityId: user.id, next: { reason: data.reason } });
    return { ok: true, message: suspend ? "User suspended and signed out." : "User reinstated." };
  });
}

export async function verifyUserEmailAction(userId: string): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("users.manage");
    await prisma.user.update({ where: { id: id.parse(userId) }, data: { emailVerifiedAt: new Date() } });
    await audit({ actorId: actor.id, action: "user.verify_email", entity: "User", entityId: userId });
    return { ok: true, message: "Email marked as verified." };
  });
}

export async function assignCoachAction(userId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("coaches.manage");
    const { coachId, remove } = parseForm(z.object({ coachId: id, remove: z.enum(["true", "false"]).optional() }), formData);
    const member = await prisma.user.findUnique({ where: { id: id.parse(userId) } });
    const coach = await prisma.coachProfile.findUnique({ where: { id: coachId }, include: { user: true } });
    if (!member || !coach) throw new UserError("Not found.");
    if (remove === "true") {
      await prisma.coachMember.deleteMany({ where: { coachId, memberId: member.id } });
      await audit({ actorId: actor.id, action: "coach.unassign", entity: "CoachMember", entityId: `${coachId}:${member.id}` });
      return { ok: true, message: "Coach unassigned." };
    }
    await prisma.coachMember.upsert({ where: { coachId_memberId: { coachId, memberId: member.id } }, create: { coachId, memberId: member.id }, update: {} });
    const ids = [
      (await notify({ userId: member.id, type: "COACH_ASSIGNED", title: "You have a coach", body: `${coach.user.name} is now your coach.`, link: `/coaches/${coach.slug}` })).id,
      (await notify({ userId: coach.userId, type: "COACH_ASSIGNED", title: "New member assigned", body: `${member.name} has been assigned to you.`, link: "/coach/members" })).id,
    ];
    await emailNotifications(ids);
    await audit({ actorId: actor.id, action: "coach.assign", entity: "CoachMember", entityId: `${coachId}:${member.id}` });
    return { ok: true, message: `Assigned to ${coach.user.name}.` };
  });
}

// ─── Memberships ──────────────────────────────────────────────────────────

export async function grantMembershipAction(userId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("memberships.manage");
    const { planId, note } = parseForm(z.object({ planId: id, note: z.string().trim().min(3, "Add a reason").max(300) }), formData);
    const plan = await prisma.membershipPlan.findUnique({ where: { id: planId } });
    const user = await prisma.user.findUnique({ where: { id: id.parse(userId) } });
    if (!plan || !user) throw new UserError("Not found.");
    const now = new Date();
    const current = await prisma.membership.findFirst({ where: { userId: user.id, planId, ...activeMembershipWhere(now) } });
    let membershipId: string;
    if (current?.expiresAt) {
      const expiresAt = addBillingPeriod(current.expiresAt, plan.billingPeriod);
      await prisma.membership.update({ where: { id: current.id }, data: { expiresAt } });
      membershipId = current.id;
    } else {
      membershipId = (await prisma.membership.create({ data: { userId: user.id, planId, status: "ACTIVE", startsAt: now, expiresAt: addBillingPeriod(now, plan.billingPeriod) } })).id;
    }
    const n = await notify({ userId: user.id, type: "MEMBERSHIP_ACTIVATED", title: `${plan.name} activated`, body: "The club has activated your membership.", link: "/dashboard/membership" });
    await emailNotifications([n.id]);
    await audit({ actorId: actor.id, action: "membership.grant", entity: "Membership", entityId: membershipId, next: { planId, note, complimentary: true } });
    return { ok: true, message: "Membership granted (complimentary — no payment recorded)." };
  });
}

export async function adjustMembershipAction(membershipId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("memberships.manage");
    const data = parseForm(z.object({ op: z.enum(["extend", "cancel"]), days: z.coerce.number().int().min(1).max(366).optional(), note: z.string().trim().min(3, "Add a reason").max(300) }), formData);
    const m = await prisma.membership.findUnique({ where: { id: id.parse(membershipId) }, include: { plan: true } });
    if (!m) throw new UserError("Membership not found.");
    if (data.op === "extend") {
      if (!data.days) throw new UserError("Enter the number of days.", { days: "Required" });
      const base = m.expiresAt && m.expiresAt > new Date() ? m.expiresAt : new Date();
      const expiresAt = new Date(base.getTime() + data.days * 86400_000);
      await prisma.membership.update({ where: { id: m.id }, data: { expiresAt, status: "ACTIVE", startsAt: m.startsAt ?? new Date() } });
      await audit({ actorId: actor.id, action: "membership.extend", entity: "Membership", entityId: m.id, previous: { expiresAt: m.expiresAt }, next: { expiresAt, note: data.note } });
      return { ok: true, message: `Extended by ${data.days} days.` };
    }
    await prisma.membership.update({ where: { id: m.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    const n = await notify({ userId: m.userId, type: "MEMBERSHIP_EXPIRED", title: "Membership cancelled", body: `Your ${m.plan.name} membership was cancelled by the club. ${data.note}`, link: "/dashboard/membership" });
    await emailNotifications([n.id]);
    await audit({ actorId: actor.id, action: "membership.cancel", entity: "Membership", entityId: m.id, previous: { status: m.status }, next: { status: "CANCELLED", note: data.note } });
    return { ok: true, message: "Membership cancelled." };
  });
}

// ─── Bookings & registrations ─────────────────────────────────────────────

export async function adminCancelBookingAction(bookingId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("bookings.manage");
    const reason = z.string().trim().min(3, "Give a reason").max(300).parse(formData.get("reason"));
    const result = await cancelBooking(id.parse(bookingId), { id: actor.id, asStaff: true }, reason);
    await emailNotifications([result.notificationId]);
    await audit({ actorId: actor.id, action: "booking.cancel", entity: "Booking", entityId: bookingId, previous: { status: result.booking.status }, next: { status: "CANCELLED", reason, refundDue: result.paid } });
    return { ok: true, message: result.paid ? "Cancelled. This booking was paid — process the refund per policy." : "Booking cancelled." };
  });
}

export async function adminRescheduleBookingAction(bookingId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("bookings.manage");
    const { timezone } = (await getAllSettings()).general;
    const data = parseForm(z.object({ date: z.string().date(), time: z.string().refine(isValidClock, "Pick a time"), coachId: z.string().max(40).optional() }), formData);
    const result = await rescheduleBooking(id.parse(bookingId), actor.id, { startsAt: zonedTimeToUtc(data.date, data.time, timezone), coachId: data.coachId || undefined });
    await emailNotifications([result.notificationId]);
    await audit({ actorId: actor.id, action: "booking.reschedule", entity: "Booking", entityId: bookingId, previous: { startsAt: result.previous.startsAt, coachId: result.previous.coachId }, next: { startsAt: result.booking.startsAt, coachId: result.booking.coachId } });
    return { ok: true, message: "Booking rescheduled and the member notified." };
  });
}

export async function adminCancelRegistrationAction(registrationId: string): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("events.manage");
    const { registration, paid } = await cancelRegistration(id.parse(registrationId), { id: actor.id, asStaff: true });
    const n = await notify({ userId: registration.userId, type: "EVENT_REGISTERED", title: "Registration cancelled", body: `Your registration for ${registration.event.title} was cancelled by the club.${paid ? " We'll be in touch about your refund." : ""}`, link: "/dashboard/events" });
    await emailNotifications([n.id]);
    await audit({ actorId: actor.id, action: "event_registration.cancel", entity: "EventRegistration", entityId: registrationId, next: { refundDue: paid } });
    return { ok: true, message: "Registration cancelled." };
  });
}

export async function checkInRegistrationAction(registrationId: string): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("events.manage");
    const { count } = await prisma.eventRegistration.updateMany({ where: { id: id.parse(registrationId), status: "CONFIRMED" }, data: { status: "ATTENDED", checkedInAt: new Date() } });
    if (!count) throw new UserError("Only confirmed registrations can be checked in.");
    await audit({ actorId: actor.id, action: "event_registration.check_in", entity: "EventRegistration", entityId: registrationId });
    return { ok: true, message: "Checked in." };
  });
}

/** Front desk: look up a pass code, booking or event reference and check it in. */
export async function frontDeskAction(formData: FormData): Promise<ActionResult<{ kind: string; detail: string }>> {
  return runAction(async () => {
    const actor = await assertPermission("bookings.manage");
    const code = z.string().trim().toUpperCase().min(4).max(20).parse(formData.get("code"));
    const pass = await prisma.servicePurchase.findUnique({ where: { code }, include: { service: true, user: true } });
    if (pass) {
      if (pass.status !== "ACTIVE" || (pass.validUntil && pass.validUntil < new Date())) throw new UserError(`Pass ${code} is ${pass.status.toLowerCase()}${pass.validUntil && pass.validUntil < new Date() ? " (expired)" : ""}.`);
      await prisma.servicePurchase.update({ where: { id: pass.id }, data: { status: "REDEEMED", redeemedAt: new Date() } });
      await audit({ actorId: actor.id, action: "pass.redeem", entity: "ServicePurchase", entityId: pass.id });
      return { ok: true, message: "Pass redeemed.", data: { kind: pass.service.name, detail: pass.user.name } };
    }
    const reg = await prisma.eventRegistration.findUnique({ where: { reference: code }, include: { event: true, user: true } });
    if (reg) {
      if (reg.status !== "CONFIRMED") throw new UserError(`Registration ${code} is ${reg.status.toLowerCase()}.`);
      await prisma.eventRegistration.update({ where: { id: reg.id }, data: { status: "ATTENDED", checkedInAt: new Date() } });
      await audit({ actorId: actor.id, action: "event_registration.check_in", entity: "EventRegistration", entityId: reg.id });
      return { ok: true, message: "Checked in.", data: { kind: reg.event.title, detail: reg.user.name } };
    }
    const booking = await prisma.booking.findUnique({ where: { reference: code }, include: { sessionType: true, member: true } });
    if (booking) {
      if (booking.status !== "CONFIRMED") throw new UserError(`Booking ${code} is ${booking.status.toLowerCase()}.`);
      return { ok: true, message: "Booking confirmed — the coach records the outcome.", data: { kind: booking.sessionType.name, detail: booking.member.name } };
    }
    throw new UserError(`No pass, booking or registration matches ${code}.`);
  });
}

// ─── Payments ─────────────────────────────────────────────────────────────

export async function reconcilePaymentAction(paymentId: string): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("payments.reconcile");
    const status = await reconcilePayment(id.parse(paymentId), actor.id);
    await audit({ actorId: actor.id, action: "payment.reconcile", entity: "Payment", entityId: paymentId, next: { status } });
    return { ok: true, message: status ? `Provider status: ${String(status).toLowerCase()}.` : "This payment has no provider reference to query." };
  });
}

export async function settlePaymentManuallyAction(paymentId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("payments.reconcile");
    if (actor.role !== "SUPER_ADMIN") throw new UserError("Manual settlement is restricted to super admins.");
    const data = parseForm(z.object({ receipt: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8,12}$/, "Enter the M-Pesa receipt code"), note: z.string().trim().min(5, "Explain how this was verified").max(300) }), formData);
    await settleManually(id.parse(paymentId), actor.id, data.receipt, data.note);
    return { ok: true, message: "Payment settled and the order fulfilled." };
  });
}

export async function markRefundedAction(paymentId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("payments.reconcile");
    const note = z.string().trim().min(5, "Add the refund reference / note").max(300).parse(formData.get("note"));
    const payment = await prisma.payment.findUnique({ where: { id: id.parse(paymentId) } });
    if (!payment || payment.status !== "SUCCESS") throw new UserError("Only successful payments can be marked refunded.");
    await prisma.$transaction([
      prisma.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } }),
      prisma.order.update({ where: { id: payment.orderId }, data: { status: "REFUNDED" } }),
      prisma.paymentTransaction.create({ data: { paymentId: payment.id, kind: "MANUAL", status: "REFUNDED", message: note, actorId: actor.id } }),
    ]);
    await audit({ actorId: actor.id, action: "payment.refund", entity: "Payment", entityId: payment.id, previous: { status: "SUCCESS" }, next: { status: "REFUNDED", note } });
    return { ok: true, message: "Marked as refunded. Remember to complete the reversal in M-Pesa." };
  });
}

// ─── Payment settings ─────────────────────────────────────────────────────

export async function savePaymentConfigAction(providerId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("payments.configure");
    const data = parseForm(
      z.object({
        enabled: z.preprocess((v) => v === "true", z.boolean()),
        isDefault: z.preprocess((v) => v === "true", z.boolean()),
        environment: z.enum(["sandbox", "production"]),
        shortcode: z.string().trim().regex(/^\d{5,7}$|^$/, "5–7 digits").optional().transform((v) => v || null),
        tillNumber: z.string().trim().regex(/^\d{5,8}$|^$/, "5–8 digits").optional().transform((v) => v || null),
        paybillNumber: z.string().trim().regex(/^\d{5,7}$|^$/, "5–7 digits").optional().transform((v) => v || null),
        transactionType: z.enum(["CustomerPayBillOnline", "CustomerBuyGoodsOnline"]),
        callbackUrl: z.union([z.literal(""), z.string().trim().url().refine((u) => u.startsWith("https://") || u.startsWith("http://localhost") || u.startsWith("http://127.0.0.1"), "Use an HTTPS URL")]).optional().transform((v) => v || null),
        accountReferenceFormat: z.string().trim().min(1).max(30).refine((v) => v.includes("{order}") || v.length <= 12, "Include {order} or keep it to 12 characters"),
        transactionDescription: z.string().trim().min(1).max(13),
        currency: z.string().trim().length(3).toUpperCase(),
        timeoutMinutes: z.coerce.number().int().min(1).max(30),
        verifyWithQuery: z.preprocess((v) => v === "true", z.boolean()),
        allowedCallbackIps: z.string().optional().transform((v) => (v ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)),
      }),
      formData,
    );
    const provider = await prisma.paymentProvider.findUnique({ where: { id: id.parse(providerId) }, include: { config: true } });
    if (!provider) throw new UserError("Provider not found.");
    const { enabled, isDefault, ...config } = data;
    if (enabled && providerImplementation(provider.key)) {
      const impl = providerImplementation(provider.key)!;
      await prisma.paymentConfiguration.upsert({ where: { providerId: provider.id }, create: { providerId: provider.id, ...config }, update: config });
      const readiness = await impl.readiness();
      if (!readiness.ready) throw new UserError(`Saved the settings, but M-Pesa can't be enabled yet. Missing: ${readiness.missing.join(", ")}.`);
    }
    await prisma.$transaction(async (tx) => {
      if (isDefault) await tx.paymentProvider.updateMany({ where: { id: { not: provider.id } }, data: { isDefault: false } });
      await tx.paymentProvider.update({ where: { id: provider.id }, data: { enabled, isDefault } });
      await tx.paymentConfiguration.upsert({ where: { providerId: provider.id }, create: { providerId: provider.id, ...config }, update: config });
    });
    await audit({ actorId: actor.id, action: "payment_settings.update", entity: "PaymentProvider", entityId: provider.id, previous: { enabled: provider.enabled, ...provider.config }, next: data });
    return { ok: true, message: "Payment settings saved." };
  });
}

export async function savePaymentSecretsAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("payments.secrets");
    const values: Partial<Record<SecretKey, string>> = {};
    for (const key of Object.keys(SECRET_DEFINITIONS) as SecretKey[]) {
      const v = formData.get(key);
      if (typeof v === "string" && v.trim()) values[key] = v.trim().slice(0, 500);
    }
    const changed = await storeSecrets(values, actor.id);
    if (!changed.length) throw new UserError("Enter at least one new value. Blank fields keep their current value.");
    await audit({ actorId: actor.id, action: "secrets.update", entity: "IntegrationSecret", entityId: changed.join(","), next: { keys: changed } });
    return { ok: true, message: `Updated ${changed.length} credential${changed.length > 1 ? "s" : ""}. Values are encrypted and never shown again.` };
  });
}

export async function clearSecretAction(key: string): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("payments.secrets");
    if (!(key in SECRET_DEFINITIONS)) throw new UserError("Unknown credential.");
    await clearSecret(key as SecretKey);
    await audit({ actorId: actor.id, action: "secrets.clear", entity: "IntegrationSecret", entityId: key });
    return { ok: true, message: "Credential removed." };
  });
}

export async function testPaymentConnectionAction(providerId: string): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("payments.configure");
    const provider = await prisma.paymentProvider.findUnique({ where: { id: id.parse(providerId) } });
    const impl = provider ? providerImplementation(provider.key) : null;
    if (!impl) throw new UserError("Provider not found.");
    const readiness = await impl.readiness();
    if (!readiness.ready) throw new UserError(`Missing: ${readiness.missing.join(", ")}.`);
    // A status query for a non-existent request proves authentication and reachability without charging anyone.
    const outcome = await impl.query("ws_CO_connection_test");
    const raw = JSON.stringify(outcome.raw ?? {});
    await audit({ actorId: actor.id, action: "payment_settings.test", entity: "PaymentProvider", entityId: provider!.id });
    if (/authentication failed|Invalid Access Token|reach/i.test(`${outcome.message} ${raw}`)) throw new UserError(`Connection failed: ${outcome.message ?? "authentication error"}`);
    return { ok: true, message: `Connected to M-Pesa ${readiness.environment}. Credentials were accepted.` };
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────

export async function saveSettingsAction(group: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("settings.manage");
    if (!(group in SETTINGS_SCHEMAS)) throw new UserError("Unknown settings group.");
    const raw = Object.fromEntries([...formData.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]));
    const previous = (await getAllSettings())[group as SettingsGroup];
    const parsed = SETTINGS_SCHEMAS[group as SettingsGroup].safeParse(raw);
    if (!parsed.success) {
      const fieldErrors = Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message]));
      return { ok: false, error: "Please check the highlighted fields.", fieldErrors };
    }
    await saveSettings(group as SettingsGroup, parsed.data);
    await audit({ actorId: actor.id, action: "settings.update", entity: "SiteSetting", entityId: group, previous, next: parsed.data });
    revalidatePath("/", "layout");
    return { ok: true, message: "Settings saved." };
  });
}

// ─── Roles & permissions ──────────────────────────────────────────────────

export async function saveRolePermissionsAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("roles.manage");
    const editable: Role[] = ["ADMIN", "COACH", "MODERATOR", "MEMBER"];
    const permissions = await prisma.permission.findMany();
    const byKey = new Map(permissions.map((p) => [p.key, p.id]));
    const grants: { role: Role; permissionId: string }[] = [];
    for (const role of editable) {
      for (const key of PERMISSIONS) {
        if (formData.get(`${role}:${key}`) === "on" && byKey.has(key)) grants.push({ role, permissionId: byKey.get(key)! });
      }
    }
    const previous = await prisma.rolePermission.findMany({ where: { role: { in: editable } }, include: { permission: true } });
    await prisma.$transaction([prisma.rolePermission.deleteMany({ where: { role: { in: editable } } }), prisma.rolePermission.createMany({ data: grants })]);
    await audit({ actorId: actor.id, action: "roles.update", entity: "RolePermission", previous: previous.map((p) => `${p.role}:${p.permission.key}`), next: grants.map((g) => `${g.role}:${permissions.find((p) => p.id === g.permissionId)?.key}`) });
    return { ok: true, message: "Permissions updated." };
  });
}

// ─── Community moderation ─────────────────────────────────────────────────

export async function moderatePostAction(postId: string, action: "hide" | "remove" | "restore" | "pin" | "unpin"): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("community.moderate");
    const post = await prisma.communityPost.findUnique({ where: { id: id.parse(postId) } });
    if (!post) throw new UserError("Post not found.");
    const data =
      action === "pin" ? { pinned: true } :
      action === "unpin" ? { pinned: false } :
      { status: action === "hide" ? ("HIDDEN" as const) : action === "remove" ? ("REMOVED" as const) : ("VISIBLE" as const), moderatedById: actor.id, moderatedAt: new Date() };
    await prisma.communityPost.update({ where: { id: post.id }, data });
    await audit({ actorId: actor.id, action: `community.post_${action}`, entity: "CommunityPost", entityId: post.id, previous: { status: post.status, pinned: post.pinned } });
    return { ok: true, message: `Post ${action === "pin" ? "pinned" : action === "unpin" ? "unpinned" : action === "restore" ? "restored" : action === "hide" ? "hidden" : "removed"}.` };
  });
}

export async function moderateCommentAction(commentId: string, action: "hide" | "restore"): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("community.moderate");
    const comment = await prisma.communityComment.update({ where: { id: id.parse(commentId) }, data: { status: action === "hide" ? "HIDDEN" : "VISIBLE" } });
    await refreshPostCounters(comment.postId);
    await audit({ actorId: actor.id, action: `community.comment_${action}`, entity: "CommunityComment", entityId: comment.id });
    return { ok: true, message: action === "hide" ? "Comment hidden." : "Comment restored." };
  });
}

export async function resolveReportAction(reportId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("community.moderate");
    const data = parseForm(z.object({ outcome: z.enum(["RESOLVED", "DISMISSED"]), takeDown: z.enum(["none", "hide", "remove"]).default("none"), suspendAuthor: z.enum(["true", "false"]).optional(), resolution: z.string().trim().max(500).optional() }), formData);
    const report = await prisma.communityReport.findUnique({ where: { id: id.parse(reportId) }, include: { post: true, comment: true } });
    if (!report) throw new UserError("Report not found.");
    if (data.takeDown !== "none") {
      if (report.comment) {
        await prisma.communityComment.update({ where: { id: report.comment.id }, data: { status: data.takeDown === "hide" ? "HIDDEN" : "REMOVED" } });
        await refreshPostCounters(report.comment.postId);
      } else if (report.post) {
        await prisma.communityPost.update({ where: { id: report.post.id }, data: { status: data.takeDown === "hide" ? "HIDDEN" : "REMOVED", moderatedById: actor.id, moderatedAt: new Date() } });
      }
    }
    const authorId = report.comment?.authorId ?? report.post?.authorId;
    if (data.suspendAuthor === "true" && authorId) {
      if (!(await can(actor.role, "users.manage"))) throw new UserError("Suspending members needs the users.manage permission.");
      const author = await prisma.user.findUnique({ where: { id: authorId } });
      if (author && author.role !== "SUPER_ADMIN" && author.id !== actor.id) {
        await prisma.user.update({ where: { id: authorId }, data: { suspendedAt: new Date(), suspensionReason: data.resolution || "Community guidelines" } });
        await prisma.session.deleteMany({ where: { userId: authorId } });
        await audit({ actorId: actor.id, action: "user.suspend", entity: "User", entityId: authorId, next: { reason: data.resolution, reportId: report.id } });
      }
    }
    await prisma.communityReport.updateMany({
      where: { status: "OPEN", OR: [{ id: report.id }, ...(report.postId ? [{ postId: report.postId }] : []), ...(report.commentId ? [{ commentId: report.commentId }] : [])] },
      data: { status: data.outcome, resolution: data.resolution || null, resolvedById: actor.id, resolvedAt: new Date() },
    });
    await audit({ actorId: actor.id, action: "community.report_resolve", entity: "CommunityReport", entityId: report.id, next: data });
    return { ok: true, message: "Report closed." };
  });
}

// ─── Contact inquiries ────────────────────────────────────────────────────

export async function markInquiryHandledAction(inquiryId: string): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("cms.manage");
    await prisma.contactInquiry.update({ where: { id: id.parse(inquiryId) }, data: { handledAt: new Date() } });
    await audit({ actorId: actor.id, action: "inquiry.handle", entity: "ContactInquiry", entityId: inquiryId });
    return { ok: true, message: "Marked as handled." };
  });
}

// ─── Broadcast notifications ──────────────────────────────────────────────

export async function broadcastAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("notifications.manage");
    const data = parseForm(
      z.object({
        audience: z.enum(["ALL", "ACTIVE_MEMBERS", "NO_MEMBERSHIP", "PLAN", "ROLE"]),
        planId: z.string().max(40).optional(),
        role: z.enum(ROLE_VALUES).optional(),
        title: z.string().trim().min(3).max(120),
        body: z.string().trim().min(3).max(2000),
        link: z.union([z.literal(""), z.string().trim().startsWith("/")]).optional(),
        email: z.preprocess((v) => v === "true", z.boolean()),
      }),
      formData,
    );
    const now = new Date();
    const base = { suspendedAt: null, deletedAt: null, emailVerifiedAt: { not: null } };
    const where =
      data.audience === "ACTIVE_MEMBERS" ? { ...base, memberships: { some: activeMembershipWhere(now) } } :
      data.audience === "NO_MEMBERSHIP" ? { ...base, role: "MEMBER" as const, memberships: { none: activeMembershipWhere(now) } } :
      data.audience === "PLAN" ? { ...base, memberships: { some: { ...activeMembershipWhere(now), planId: data.planId } } } :
      data.audience === "ROLE" ? { ...base, role: data.role } :
      base;
    if (data.audience === "PLAN" && !data.planId) throw new UserError("Choose a plan.", { planId: "Required" });
    if (data.audience === "ROLE" && !data.role) throw new UserError("Choose a role.", { role: "Required" });
    const users = await prisma.user.findMany({ where, select: { id: true } });
    if (!users.length) throw new UserError("No one matches that audience.");
    await prisma.notification.createMany({ data: users.map((u) => ({ userId: u.id, type: "ANNOUNCEMENT", title: data.title, body: data.body, link: data.link || null })) });
    if (data.email) {
      const created = await prisma.notification.findMany({ where: { userId: { in: users.map((u) => u.id) }, type: "ANNOUNCEMENT", title: data.title, createdAt: { gte: new Date(now.getTime() - 60_000) } }, select: { id: true } });
      void emailNotifications(created.map((c) => c.id)).catch((e) => console.error("[broadcast] email", e));
    }
    await audit({ actorId: actor.id, action: "notification.broadcast", entity: "Notification", next: { ...data, recipients: users.length } });
    return { ok: true, message: `Sent to ${users.length} ${users.length === 1 ? "person" : "people"}${data.email ? " (emails sending in the background)" : ""}.` };
  });
}

// ─── Coach availability (admin) ───────────────────────────────────────────

export async function adminSaveCoachAvailabilityAction(coachId: string, windowsJson: string): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("coaches.manage");
    const windows = z
      .array(z.object({ weekday: z.number().int().min(0).max(6), startTime: z.string().refine(isValidClock), endTime: z.string().refine(isValidClock) }).refine((w) => minutesOf(w.startTime) < minutesOf(w.endTime), "End after start"))
      .max(70)
      .parse(JSON.parse(windowsJson));
    const coach = await prisma.coachProfile.findUnique({ where: { id: id.parse(coachId) } });
    if (!coach) throw new UserError("Coach not found.");
    const previous = await prisma.coachAvailability.findMany({ where: { coachId: coach.id }, select: { weekday: true, startTime: true, endTime: true } });
    await prisma.$transaction([prisma.coachAvailability.deleteMany({ where: { coachId: coach.id } }), prisma.coachAvailability.createMany({ data: windows.map((w) => ({ ...w, coachId: coach.id })) })]);
    await audit({ actorId: actor.id, action: "coach.availability_update", entity: "CoachProfile", entityId: coach.id, previous, next: windows });
    return { ok: true, message: "Availability saved." };
  });
}

export async function runMaintenanceAction(): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertPermission("payments.reconcile");
    const { runMaintenance } = await import("@/server/maintenance");
    const result = await runMaintenance();
    await audit({ actorId: actor.id, action: "maintenance.run", entity: "System", next: result });
    return { ok: true, message: `Done: ${result.payments.reconciled} payments checked, ${result.payments.ordersExpired} orders expired, ${result.membershipsExpired} memberships expired.` };
  });
}
