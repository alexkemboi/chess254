import { Users } from "lucide-react";
import { prisma } from "@/server/db";
import { requireCoach, coachMemberIds } from "@/server/coach";
import { getSettings } from "@/server/settings";
import { activeMembershipWhere } from "@/server/memberships";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { initials } from "@/lib/utils";

export default async function CoachMembers() {
  const { coach } = await requireCoach();
  const { timezone } = await getSettings("general");
  const ids = await coachMemberIds(coach.id);
  const members = await prisma.user.findMany({
    where: { id: { in: ids } },
    include: {
      memberProfile: true,
      memberships: { where: activeMembershipWhere(), include: { plan: true } },
      learningProgress: { where: { status: "COMPLETED" }, select: { id: true } },
      assignmentsReceived: { where: { coachId: coach.id }, select: { status: true } },
      bookings: { where: { coachId: coach.id }, orderBy: { startsAt: "desc" }, take: 1, select: { startsAt: true } },
      _count: { select: { puzzleAttempts: { where: { solved: true } } } },
    },
    orderBy: { name: "asc" },
  });
  return (
    <div>
      <PageHeader eyebrow="Members" title="Players you coach" description="Assigned members and anyone who has booked you." />
      {members.length === 0 ? (
        <EmptyState icon={<Users />} title="No members yet" description="Members appear here once they're assigned to you or book a session." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {members.map((m) => {
            const open = m.assignmentsReceived.filter((a) => a.status === "ASSIGNED" || a.status === "SUBMITTED").length;
            return (
              <div key={m.id} className="rounded-3xl border border-border bg-surface p-5">
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-full bg-brand-soft font-bold text-brand">{initials(m.name)}</span>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{m.name}</div>
                    <div className="truncate text-xs text-muted">{m.memberProfile?.chessLevel ?? "Level not set"}{m.memberProfile?.rating ? ` · ${m.memberProfile.rating}` : ""}</div>
                  </div>
                  {m.memberships[0] ? <Badge variant="success" className="ml-auto">{m.memberships[0].plan.name}</Badge> : <Badge variant="neutral" className="ml-auto">No plan</Badge>}
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-surface-2 p-2"><dt className="text-[11px] text-muted">Lessons</dt><dd className="font-display text-lg font-bold">{m.learningProgress.length}</dd></div>
                  <div className="rounded-xl bg-surface-2 p-2"><dt className="text-[11px] text-muted">Puzzles</dt><dd className="font-display text-lg font-bold">{m._count.puzzleAttempts}</dd></div>
                  <div className="rounded-xl bg-surface-2 p-2"><dt className="text-[11px] text-muted">Open tasks</dt><dd className="font-display text-lg font-bold">{open}</dd></div>
                </dl>
                <div className="mt-3 text-xs text-muted">Puzzle rating {m.memberProfile?.puzzleRating ?? "—"}{m.bookings[0] ? ` · last session ${formatDate(m.bookings[0].startsAt, timezone)}` : ""}</div>
                {m.memberProfile?.bio && <p className="mt-2 line-clamp-2 text-sm text-muted">{m.memberProfile.bio}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
