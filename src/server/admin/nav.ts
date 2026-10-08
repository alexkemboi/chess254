import "server-only";
import type { Permission } from "@/server/rbac";
import { permissionsFor } from "@/server/rbac";
import type { Role } from "@prisma/client";

export type NavItem = { href: string; label: string; permission: Permission; icon: string };
export type NavGroup = { label: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  { label: "Overview", items: [
    { href: "/admin", label: "Dashboard", permission: "dashboard.view", icon: "LayoutDashboard" },
    { href: "/admin/checkin", label: "Front desk", permission: "bookings.manage", icon: "ScanLine" },
  ] },
  { label: "People", items: [
    { href: "/admin/users", label: "Users & members", permission: "users.view", icon: "Users" },
    { href: "/admin/memberships", label: "Memberships", permission: "memberships.manage", icon: "Crown" },
    { href: "/admin/manage/plans", label: "Membership plans", permission: "memberships.manage", icon: "BadgeDollarSign" },
    { href: "/admin/roles", label: "Roles & permissions", permission: "roles.manage", icon: "ShieldCheck" },
  ] },
  { label: "Coaching", items: [
    { href: "/admin/bookings", label: "Bookings", permission: "bookings.manage", icon: "CalendarCheck" },
    { href: "/admin/manage/coaches", label: "Coaches", permission: "coaches.manage", icon: "GraduationCap" },
    { href: "/admin/manage/session-types", label: "Session types", permission: "sessions.manage", icon: "Clock" },
    { href: "/admin/manage/services", label: "Services & passes", permission: "sessions.manage", icon: "Ticket" },
  ] },
  { label: "Events", items: [
    { href: "/admin/manage/events", label: "Events", permission: "events.manage", icon: "CalendarDays" },
    { href: "/admin/registrations", label: "Registrations", permission: "events.manage", icon: "ClipboardList" },
  ] },
  { label: "Learning", items: [
    { href: "/admin/manage/materials", label: "Materials", permission: "learning.manage", icon: "BookOpen" },
    { href: "/admin/manage/learning-categories", label: "Categories", permission: "learning.manage", icon: "FolderTree" },
    { href: "/admin/manage/puzzles", label: "Puzzles", permission: "puzzles.manage", icon: "Puzzle" },
  ] },
  { label: "Community", items: [
    { href: "/admin/moderation", label: "Moderation", permission: "community.moderate", icon: "Flag" },
    { href: "/admin/inquiries", label: "Contact messages", permission: "cms.manage", icon: "Inbox" },
  ] },
  { label: "Content", items: [
    { href: "/admin/manage/content", label: "Page content", permission: "cms.manage", icon: "LayoutTemplate" },
    { href: "/admin/manage/announcements", label: "Announcements", permission: "cms.manage", icon: "Megaphone" },
    { href: "/admin/manage/gallery", label: "Gallery", permission: "gallery.manage", icon: "Images" },
    { href: "/admin/manage/gallery-categories", label: "Gallery categories", permission: "gallery.manage", icon: "Tags" },
    { href: "/admin/manage/testimonials", label: "Testimonials", permission: "cms.manage", icon: "Quote" },
    { href: "/admin/manage/faqs", label: "FAQs", permission: "cms.manage", icon: "HelpCircle" },
    { href: "/admin/manage/social-links", label: "Social links", permission: "cms.manage", icon: "Share2" },
    { href: "/admin/manage/seo", label: "SEO", permission: "cms.manage", icon: "Search" },
  ] },
  { label: "Finance", items: [
    { href: "/admin/payments", label: "Payments", permission: "payments.view", icon: "Smartphone" },
    { href: "/admin/invoices", label: "Invoices", permission: "payments.view", icon: "Receipt" },
    { href: "/admin/reports", label: "Reports", permission: "reports.view", icon: "BarChart3" },
  ] },
  { label: "System", items: [
    { href: "/admin/notifications", label: "Notifications", permission: "notifications.manage", icon: "Bell" },
    { href: "/admin/settings", label: "Settings", permission: "settings.manage", icon: "Settings" },
    { href: "/admin/manage/locations", label: "Locations & hours", permission: "settings.manage", icon: "MapPin" },
    { href: "/admin/payment-settings", label: "Payment settings", permission: "payments.configure", icon: "CreditCard" },
    { href: "/admin/audit", label: "Audit log", permission: "audit.view", icon: "History" },
  ] },
];

export async function navFor(role: Role) {
  const perms = await permissionsFor(role);
  return GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => perms.has(i.permission)) })).filter((g) => g.items.length);
}
