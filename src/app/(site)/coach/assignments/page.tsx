import { prisma } from "@/server/db";
import { requireCoach, coachMemberIds } from "@/server/coach";
import { getSettings } from "@/server/settings";
import { PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/badge";
import { NewAssignmentForm, ReviewForm, WithdrawAssignment } from "@/components/coach/coach-ui";
import { formatDate } from "@/lib/format";

export default async function CoachAssignments() {
  const { coach } = await requireCoach();
  const { timezone } = await getSettings("general");
  const ids = await coachMemberIds(coach.id);
  const [members, materials, assignments] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.learningMaterial.findMany({ where: { published: true, deletedAt: null }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    prisma.learningAssignment.findMany({ where: { coachId: coach.id, status: { not: "CANCELLED" } }, include: { member: { select: { name: true } }, material: { select: { title: true } } }, orderBy: [{ status: "desc" }, { createdAt: "desc" }], take: 100 }),
  ]);
  return (
    <div className="grid gap-10">
      <PageHeader eyebrow="Learning" title="Assignments" description="Set work for your members and review what they submit." />
      <section className="rounded-3xl border border-border bg-surface p-6">
        <h2 className="mb-4 font-semibold">New assignment</h2>
        {members.length ? <NewAssignmentForm members={members} materials={materials} /> : <p className="text-sm text-muted">You’ll be able to assign work once members are linked to you or book a session.</p>}
      </section>
      <section className="grid gap-3">
        {assignments.length === 0 && <p className="text-sm text-muted">No assignments yet.</p>}
        {assignments.map((a) => (
          <div key={a.id} className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{a.title}</span><StatusBadge status={a.status} /><span className="text-sm text-muted">· {a.member.name}</span><span className="ml-auto">{a.status !== "REVIEWED" && <WithdrawAssignment id={a.id} />}</span></div>
            <div className="text-xs text-muted">Set {formatDate(a.createdAt, timezone)}{a.dueAt ? ` · due ${formatDate(a.dueAt, timezone)}` : ""}{a.material ? ` · ${a.material.title}` : ""}</div>
            {a.submission && <p className="mt-3 whitespace-pre-line rounded-xl bg-surface-2 p-3 text-sm">{a.submission}</p>}
            {(a.status === "SUBMITTED" || a.status === "REVIEWED") && <ReviewForm assignmentId={a.id} feedback={a.feedback} />}
          </div>
        ))}
      </section>
    </div>
  );
}
