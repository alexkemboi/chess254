import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/badge";
import { AssignmentSubmitForm } from "@/components/site/assignment-submit";
import { formatDate } from "@/lib/format";

export default async function AssignmentsPage() {
  const user = await requireUser("/dashboard/assignments");
  const { timezone } = await getSettings("general");
  const assignments = await prisma.learningAssignment.findMany({
    where: { memberId: user.id, status: { not: "CANCELLED" } },
    include: { coach: { include: { user: { select: { name: true } } } }, material: true },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
  });
  return (
    <div>
      <PageHeader eyebrow="Coaching" title="Assignments" description="Work set by your coach. Submit it before your next lesson so it can be reviewed." />
      {assignments.length === 0 ? (
        <EmptyState icon={<ClipboardList />} title="No assignments" description="When a coach assigns you work, it will appear here." />
      ) : (
        <ul className="grid gap-4">
          {assignments.map((a) => (
            <li key={a.id} className="rounded-3xl border border-border bg-surface p-6">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-xl font-bold tracking-tight">{a.title}</h2>
                <StatusBadge status={a.status} />
              </div>
              <div className="mt-1 text-sm text-muted">From {a.coach.user.name} · set {formatDate(a.createdAt, timezone)}{a.dueAt ? ` · due ${formatDate(a.dueAt, timezone)}` : ""}</div>
              {a.instructions && <p className="mt-4 whitespace-pre-line">{a.instructions}</p>}
              {a.material && <Link href={`/learn/${a.material.slug}`} className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">Open lesson: {a.material.title} →</Link>}
              {a.feedback && (
                <div className="mt-4 rounded-2xl border border-success/30 bg-success/10 p-4 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-success">Coach feedback</div>
                  <p className="mt-1 whitespace-pre-line">{a.feedback}</p>
                </div>
              )}
              {a.status !== "REVIEWED" && <AssignmentSubmitForm assignmentId={a.id} defaultValue={a.submission} />}
              {a.status === "REVIEWED" && a.submission && <p className="mt-4 whitespace-pre-line rounded-2xl bg-surface-2 p-4 text-sm text-muted">{a.submission}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
