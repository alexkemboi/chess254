import Link from "next/link";
import { BookOpen, Bookmark, CheckCircle2, PlayCircle } from "lucide-react";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { learningSummary, publishedMaterialWhere } from "@/server/learning";
import { PageHeader, EmptyState, Stat } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { formatDate, humanize } from "@/lib/format";

export default async function MyLearningPage() {
  const user = await requireUser("/dashboard/learning");
  const { timezone } = await getSettings("general");
  const [summary, progress, bookmarks, byCategory] = await Promise.all([
    learningSummary(user.id),
    prisma.learningProgress.findMany({ where: { userId: user.id, material: publishedMaterialWhere() }, include: { material: { include: { category: true } } }, orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.learningBookmark.findMany({ where: { userId: user.id, material: publishedMaterialWhere() }, include: { material: true }, orderBy: { createdAt: "desc" } }),
    prisma.learningCategory.findMany({ where: { visible: true }, orderBy: { position: "asc" }, include: { materials: { where: publishedMaterialWhere(), select: { id: true } } } }),
  ]);
  const done = new Set(progress.filter((p) => p.status === "COMPLETED").map((p) => p.materialId));
  const pct = summary.total ? Math.round((summary.completed / summary.total) * 100) : 0;
  return (
    <div className="grid gap-8">
      <PageHeader eyebrow="Academy" title="Your learning" actions={<Button asChild><Link href="/learn"><BookOpen />Browse lessons</Link></Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Completed" value={summary.completed} icon={<CheckCircle2 />} />
        <Stat label="In progress" value={summary.inProgress} icon={<PlayCircle />} />
        <Stat label="Saved" value={summary.bookmarks} icon={<Bookmark />} />
        <Stat label="Academy progress" value={`${pct}%`} hint={`${summary.completed} of ${summary.total}`} icon={<BookOpen />} />
      </div>
      {byCategory.some((c) => c.materials.length) && (
        <section className="rounded-3xl border border-border bg-surface p-6">
          <h2 className="font-semibold">Progress by topic</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {byCategory.filter((c) => c.materials.length).map((c) => {
              const completed = c.materials.filter((m) => done.has(m.id)).length;
              return (
                <Link key={c.id} href={`/learn?category=${c.slug}`} className="group">
                  <div className="flex justify-between text-sm"><span className="group-hover:text-brand-ink">{c.name}</span><span className="text-muted">{completed}/{c.materials.length}</span></div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-brand" style={{ width: `${(completed / c.materials.length) * 100}%` }} /></div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
      <section>
        <h2 className="mb-4 font-display text-xl font-bold">Recent lessons</h2>
        {progress.length ? (
          <ul className="grid gap-2">
            {progress.map((p) => (
              <li key={p.id}>
                <Link href={`/learn/${p.material.slug}`} className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-4 hover:border-border-strong">
                  <div><div className="font-semibold">{p.material.title}</div><div className="text-xs text-muted">{p.material.category.name} · {humanize(p.material.type)}</div></div>
                  <span className={p.status === "COMPLETED" ? "text-sm text-success" : "text-sm text-brand-ink"}>{p.status === "COMPLETED" ? `Completed ${formatDate(p.completedAt!, timezone)}` : "Continue →"}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={<BookOpen />} title="No lessons started" description="Start any lesson to track your progress here." />}
      </section>
      <section>
        <h2 className="mb-4 font-display text-xl font-bold">Saved for later</h2>
        {bookmarks.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {bookmarks.map((b) => <Link key={b.materialId} href={`/learn/${b.material.slug}`} className="rounded-2xl border border-border bg-surface p-4 font-semibold hover:border-brand/50">{b.material.title}</Link>)}
          </div>
        ) : <p className="text-sm text-muted">Nothing saved yet — tap “Save” on any lesson.</p>}
      </section>
    </div>
  );
}
