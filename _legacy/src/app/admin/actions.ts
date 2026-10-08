"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { clientIp, createSession, destroySession, requireAdmin } from "@/lib/auth";
import { sha256 } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";

const loginSchema = z.object({ email: z.email().max(254), password: z.string().min(1).max(200) });
export async function loginAction(formData: FormData) {
  const input = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!input.success) redirect("/admin/login?error=credentials");
  const ip = await clientIp();
  if (!(await rateLimit(`auth:admin:ip:${sha256(ip)}`, 12, 900)) || !(await rateLimit(`auth:admin:email:${sha256(input.data.email.toLowerCase())}`, 6, 900))) redirect("/admin/login?error=credentials");
  const user = await prisma.user.findUnique({ where: { email: input.data.email.toLowerCase() } }).catch(() => null);
  if (!user || user.suspendedAt || !user.emailVerifiedAt || !["SUPER_ADMIN", "ADMIN"].includes(user.role) || !(await bcrypt.compare(input.data.password, user.passwordHash))) redirect("/admin/login?error=credentials");
  await createSession(user.id);
  redirect("/admin");
}

export async function logoutAction() {
  await destroySession();
  redirect("/admin/login");
}

const planSchema = z.object({ name: z.string().trim().min(2).max(100), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120), description: z.string().trim().min(10).max(2000), price: z.coerce.number().nonnegative().max(10000000), currency: z.string().trim().length(3).toUpperCase(), billingPeriod: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL", "LIFETIME"]), features: z.string().max(2000), status: z.enum(["ACTIVE", "DRAFT", "INACTIVE", "ARCHIVED"]) });
export async function savePlanAction(formData: FormData) {
  const actor = await requireAdmin();
  const input = planSchema.safeParse(Object.fromEntries(formData));
  if (!input.success) redirect("/admin/memberships?result=invalid");
  const { features, ...plan } = input.data;
  const featureNames = [...new Set(features.split("\n").map((line) => line.trim()).filter(Boolean))];
  try {
    const created = await prisma.$transaction(async (tx) => {
      const record = await tx.membershipPlan.create({ data: plan });
      if (featureNames.length) await tx.membershipFeature.createMany({ data: featureNames.map((label, position) => ({ planId: record.id, label, position })) });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "membership_plan.created", entity: "MembershipPlan", entityId: record.id, next: { ...plan, price: input.data.price } } });
      return record;
    });
    void created;
  } catch { redirect("/admin/memberships?result=error"); }
  redirect("/admin/memberships?result=saved");
}
