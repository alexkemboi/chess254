import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { Container } from "@/components/site/cards";
import { SubNav } from "@/components/site/sub-nav";

export const metadata = { title: "Dashboard", robots: { index: false } };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/dashboard");
  const [unread, openAssignments] = await Promise.all([
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    prisma.learningAssignment.count({ where: { memberId: user.id, status: "ASSIGNED" } }),
  ]);
  return (
    <Container className="grid gap-8 py-8 lg:grid-cols-[220px_1fr] lg:py-12">
      <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <div className="mb-4 hidden px-4 lg:block">
          <div className="text-xs text-muted">Signed in as</div>
          <div className="truncate font-semibold">{user.name}</div>
        </div>
        <SubNav
          root="/dashboard"
          items={[
            { href: "/dashboard", label: "Overview" },
            { href: "/dashboard/membership", label: "Membership" },
            { href: "/dashboard/bookings", label: "Bookings" },
            { href: "/dashboard/events", label: "Events" },
            { href: "/dashboard/learning", label: "Learning" },
            { href: "/dashboard/assignments", label: "Assignments", badge: openAssignments },
            { href: "/dashboard/payments", label: "Payments" },
            { href: "/dashboard/passes", label: "Passes" },
            { href: "/dashboard/notifications", label: "Notifications", badge: unread },
            { href: "/dashboard/profile", label: "Profile" },
          ]}
        />
      </aside>
      <div className="min-w-0">{children}</div>
    </Container>
  );
}
