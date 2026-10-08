"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertPermission } from "@/server/auth";
import { runAction, parseForm, UserError, type ActionResult } from "@/server/errors";
import { audit } from "@/server/audit";
import { RESOURCES, resourceContext } from "@/server/admin/resources";
import { storeUpload } from "@/server/storage";
import { can } from "@/server/rbac";

function resource(key: string) {
  const r = RESOURCES[key];
  if (!r) throw new UserError("Unknown resource.");
  return r;
}

export async function saveResourceAction(key: string, id: string | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const r = resource(key);
    const user = await assertPermission(r.permission);
    const ctx = await resourceContext();
    const data = parseForm(r.schema(ctx), formData) as Record<string, unknown>;
    const previous = id ? await r.load(id, ctx) : null;
    if (id && !previous) throw new UserError(`This ${r.singular} no longer exists.`);
    const savedId = await r.save(id, data, ctx);
    await audit({ actorId: user.id, action: `${key}.${id ? "update" : "create"}`, entity: key, entityId: savedId, previous, next: data });
    revalidatePath("/", "layout");
    return { ok: true, message: `${r.singular[0].toUpperCase()}${r.singular.slice(1)} saved.`, redirect: id ? undefined : `/admin/manage/${key}/${savedId}` };
  });
}

export async function deleteResourceAction(key: string, id: string): Promise<ActionResult> {
  return runAction(async () => {
    const r = resource(key);
    if (!r.remove) throw new UserError("This item can't be deleted.");
    const user = await assertPermission(r.permission);
    const ctx = await resourceContext();
    const previous = await r.load(id, ctx);
    const outcome = await r.remove(id);
    await audit({ actorId: user.id, action: `${key}.${outcome === "deleted" ? "delete" : "archive"}`, entity: key, entityId: id, previous });
    revalidatePath("/", "layout");
    return { ok: true, message: outcome === "deleted" ? "Deleted." : "Archived — it's kept for history but hidden.", redirect: `/admin/manage/${key}` };
  });
}

export async function moveResourceAction(key: string, id: string, dir: -1 | 1): Promise<ActionResult> {
  return runAction(async () => {
    const r = resource(key);
    if (!r.move) throw new UserError("This list can't be reordered.");
    const user = await assertPermission(r.permission);
    await r.move(id, dir === -1 ? -1 : 1);
    await audit({ actorId: user.id, action: `${key}.reorder`, entity: key, entityId: id, next: { dir } });
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

/** Uploads for admin and coach forms. Any CMS-capable role may upload. */
export async function uploadAction(formData: FormData): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    const kind = z.enum(["image", "document"]).parse(formData.get("kind") ?? "image");
    const user = await assertPermission("admin.access").catch(async (e) => {
      const { assertUser } = await import("@/server/auth");
      const u = await assertUser();
      if (await can(u.role, "learning.manage")) return u;
      throw e;
    });
    const file = formData.get("file");
    if (!(file instanceof File)) throw new UserError("Choose a file to upload.");
    const url = await storeUpload(file, user.id, kind);
    await audit({ actorId: user.id, action: "media.upload", entity: "Media", entityId: url, next: { name: file.name, size: file.size } });
    return { ok: true, message: "Uploaded.", data: { url } };
  });
}
