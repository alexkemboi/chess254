import "server-only";
import { cache } from "react";
import type { Role } from "@prisma/client";
import { prisma } from "@/server/db";

export { PERMISSION_CATALOGUE, PERMISSIONS, ROLES, type Permission } from "@/lib/permissions";
import { PERMISSION_CATALOGUE, PERMISSIONS, type Permission } from "@/lib/permissions";

/** Loads the role → permissions matrix once per request. */
export const permissionMatrix = cache(async (): Promise<Map<Role, Set<string>>> => {
  const rows = await prisma.rolePermission.findMany({ include: { permission: { select: { key: true } } } });
  const matrix = new Map<Role, Set<string>>();
  if (rows.length === 0) {
    for (const [key, def] of Object.entries(PERMISSION_CATALOGUE)) {
      for (const role of def.defaults as readonly Role[]) {
        if (!matrix.has(role)) matrix.set(role, new Set());
        matrix.get(role)!.add(key);
      }
    }
    return matrix;
  }
  for (const row of rows) {
    if (!matrix.has(row.role)) matrix.set(row.role, new Set());
    matrix.get(row.role)!.add(row.permission.key);
  }
  return matrix;
});

/** SUPER_ADMIN always holds every permission so the matrix can never lock the club out. */
export async function can(role: Role | null | undefined, permission: Permission) {
  if (!role) return false;
  if (role === "SUPER_ADMIN") return true;
  return (await permissionMatrix()).get(role)?.has(permission) ?? false;
}

export async function permissionsFor(role: Role) {
  if (role === "SUPER_ADMIN") return new Set<string>(PERMISSIONS);
  return (await permissionMatrix()).get(role) ?? new Set<string>();
}
