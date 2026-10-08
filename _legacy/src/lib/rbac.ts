import type { Role } from "@prisma/client";

export const PERMISSIONS = {
  "dashboard.view": ["SUPER_ADMIN", "ADMIN", "STAFF", "MODERATOR", "COACH"],
  "orders.manage": ["SUPER_ADMIN", "ADMIN", "STAFF"],
  "payments.view": ["SUPER_ADMIN", "ADMIN", "STAFF"],
  "payments.reconcile": ["SUPER_ADMIN", "ADMIN"],
  "refunds.manage": ["SUPER_ADMIN", "ADMIN"],
  "catalogue.manage": ["SUPER_ADMIN", "ADMIN", "STAFF"],
  "inventory.manage": ["SUPER_ADMIN", "ADMIN", "STAFF"],
  "promotions.manage": ["SUPER_ADMIN", "ADMIN"],
  "memberships.manage": ["SUPER_ADMIN", "ADMIN"],
  "events.manage": ["SUPER_ADMIN", "ADMIN", "STAFF"],
  "coaching.manage": ["SUPER_ADMIN", "ADMIN", "COACH"],
  "learning.manage": ["SUPER_ADMIN", "ADMIN", "COACH", "MODERATOR"],
  "content.manage": ["SUPER_ADMIN", "ADMIN", "MODERATOR"],
  "community.moderate": ["SUPER_ADMIN", "ADMIN", "MODERATOR"],
  "customers.view": ["SUPER_ADMIN", "ADMIN", "STAFF"],
  "customers.manage": ["SUPER_ADMIN", "ADMIN"],
  "roles.manage": ["SUPER_ADMIN"],
  "notifications.manage": ["SUPER_ADMIN", "ADMIN"],
  "settings.manage": ["SUPER_ADMIN", "ADMIN"],
  "integrations.manage": ["SUPER_ADMIN"],
  "audit.view": ["SUPER_ADMIN", "ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export const STAFF_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "STAFF", "MODERATOR", "COACH"];

export function can(role: Role | null | undefined, permission: Permission) {
  return Boolean(role && (PERMISSIONS[permission] as readonly Role[]).includes(role));
}

export const isStaff = (role: Role | null | undefined) => Boolean(role && STAFF_ROLES.includes(role));
