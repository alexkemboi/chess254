"use server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertUser } from "@/server/auth";
import { runAction, parseForm, type ActionResult } from "@/server/errors";
import { audit } from "@/server/audit";

const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

export async function updateProfileAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const data = parseForm(
      z.object({
        name: z.string().trim().min(2).max(120),
        phone: optional(20),
        bio: optional(1000),
        chessLevel: optional(40),
        rating: z.union([z.literal(""), z.coerce.number().int().min(100).max(3500)]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
        lichessUsername: optional(40),
        chesscomUsername: optional(40),
      }),
      formData,
    );
    const { name, phone, ...profile } = data;
    await prisma.user.update({ where: { id: user.id }, data: { name, phone, memberProfile: { upsert: { create: profile, update: profile } } } });
    await audit({ actorId: user.id, action: "user.profile_update", entity: "User", entityId: user.id, next: data });
    return { ok: true, message: "Profile updated." };
  });
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true, message: "All caught up." };
  });
}

export async function markNotificationReadAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    await prisma.notification.updateMany({ where: { id: z.string().max(40).parse(id), userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  });
}
