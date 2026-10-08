import { prisma } from "@/server/db";
import { requireCoach } from "@/server/coach";
import { Container } from "@/components/site/cards";
import { SubNav } from "@/components/site/sub-nav";

export const metadata = { title: "Coach workspace", robots: { index: false } };

export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const { coach } = await requireCoach();
  const pending = await prisma.learningAssignment.count({ where: { coachId: coach.id, status: "SUBMITTED" } });
  return (
    <Container className="grid gap-8 py-8 lg:grid-cols-[220px_1fr] lg:py-12">
      <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <div className="eyebrow mb-4 hidden px-4 lg:block">Coach workspace</div>
        <SubNav
          root="/coach"
          items={[
            { href: "/coach", label: "Today" },
            { href: "/coach/sessions", label: "Sessions" },
            { href: "/coach/availability", label: "Availability" },
            { href: "/coach/members", label: "Members" },
            { href: "/coach/assignments", label: "Assignments", badge: pending },
          ]}
        />
      </aside>
      <div className="min-w-0">{children}</div>
    </Container>
  );
}
