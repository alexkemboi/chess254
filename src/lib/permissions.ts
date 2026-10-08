import type { Role } from "@prisma/client";

/**
 * Permission catalogue. The role → permission matrix lives in PostgreSQL
 * (RolePermission) and is editable by super admins; these defaults are only
 * used by the seed and as the fallback when the matrix is empty.
 */
export const PERMISSION_CATALOGUE = {
  "admin.access": { group: "Portal", description: "Open the admin portal", defaults: ["ADMIN", "MODERATOR"] },
  "dashboard.view": { group: "Portal", description: "View admin dashboard metrics", defaults: ["ADMIN"] },
  "users.view": { group: "People", description: "View user accounts", defaults: ["ADMIN"] },
  "users.manage": { group: "People", description: "Create, edit, verify and suspend users", defaults: ["ADMIN"] },
  "roles.manage": { group: "People", description: "Change roles and the permission matrix", defaults: [] },
  "members.view": { group: "People", description: "View member profiles and progress", defaults: ["ADMIN", "COACH"] },
  "memberships.manage": { group: "Memberships", description: "Manage plans and member memberships", defaults: ["ADMIN"] },
  "coaches.manage": { group: "Coaching", description: "Manage coach profiles and availability", defaults: ["ADMIN"] },
  "sessions.manage": { group: "Coaching", description: "Manage session types and services", defaults: ["ADMIN"] },
  "bookings.manage": { group: "Coaching", description: "View, cancel and reschedule all bookings", defaults: ["ADMIN"] },
  "coach.portal": { group: "Coaching", description: "Use the coach workspace", defaults: ["COACH"] },
  "events.manage": { group: "Events", description: "Manage events and registrations", defaults: ["ADMIN"] },
  "learning.manage": { group: "Learning", description: "Manage learning categories and materials", defaults: ["ADMIN", "COACH"] },
  "puzzles.manage": { group: "Learning", description: "Manage puzzles", defaults: ["ADMIN", "COACH"] },
  "community.moderate": { group: "Community", description: "Moderate posts, comments and members", defaults: ["ADMIN", "MODERATOR"] },
  "gallery.manage": { group: "Content", description: "Manage gallery images", defaults: ["ADMIN", "MODERATOR"] },
  "cms.manage": { group: "Content", description: "Manage site content, FAQs, testimonials and SEO", defaults: ["ADMIN"] },
  "payments.view": { group: "Finance", description: "View payments, orders and invoices", defaults: ["ADMIN"] },
  "payments.reconcile": { group: "Finance", description: "Re-query and reconcile payments", defaults: ["ADMIN"] },
  "payments.configure": { group: "Finance", description: "Edit non-secret payment settings", defaults: ["ADMIN"] },
  "payments.secrets": { group: "Finance", description: "Replace payment provider credentials", defaults: [] },
  "reports.view": { group: "Finance", description: "View and export reports", defaults: ["ADMIN"] },
  "notifications.manage": { group: "System", description: "Send announcements and notifications", defaults: ["ADMIN"] },
  "settings.manage": { group: "System", description: "Edit club settings", defaults: ["ADMIN"] },
  "audit.view": { group: "System", description: "View audit logs", defaults: ["ADMIN"] },
} as const satisfies Record<string, { group: string; description: string; defaults: Role[] }>;

export type Permission = keyof typeof PERMISSION_CATALOGUE;
export const PERMISSIONS = Object.keys(PERMISSION_CATALOGUE) as Permission[];
export const ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "COACH", "MODERATOR", "MEMBER"];
