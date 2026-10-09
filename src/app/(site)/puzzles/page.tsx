import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Flame, Puzzle as PuzzleIcon, Target, Trophy } from "lucide-react";
import type { Prisma, PuzzleDifficulty } from "@prisma/client";
import { prisma } from "@/server/db";
import { currentUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { seoFor } from "@/server/content";
import { puzzleOfTheDay, puzzleStats } from "@/server/puzzles";
import { Container, PageHero } from "@/components/site/cards";
import { PuzzleSolver } from "@/components/chess/puzzle-solver";
import { ChessBoard } from "@/components/chess/board";
import { EmptyState, Stat } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

const DIFFICULTIES: PuzzleDifficulty[] = ["BEGINNER", "EASY", "MEDIUM", "HARD", "EXPERT"];

export async function generateMetadata(): Promise<Metadata> {
  const seo = await seoFor("/puzzles");
  return { title: seo?.title ?? "Puzzle room", description: seo?.description ?? "Interactive chess puzzles with ratings and streaks.", alternates: { canonical: "/puzzles" } };
}

export default async function PuzzlesPage({ searchParams }: { searchParams: Promise<{ difficulty?: string; theme?: string; q?: string; status?: string }> }) {
  const sp = await searchParams;
  const user = await currentUser();
  const { timezone } = await getSettings("general");
  const difficulty = DIFFICULTIES.includes(sp.difficulty as PuzzleDifficulty) ? (sp.difficulty as PuzzleDifficulty) : undefined;
  const q = sp.q?.trim().slice(0, 80);
  const where: Prisma.PuzzleWhereInput = {
    published: true,
    ...(difficulty ? { difficulty } : {}),
    ...(sp.theme ? { theme: sp.theme } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { theme: { contains: q, mode: "insensitive" } }] } : {}),
    ...(user && sp.status === "unsolved" ? { attempts: { none: { userId: user.id, solved: true } } } : {}),
    ...(user && sp.status === "solved" ? { attempts: { some: { userId: user.id, solved: true } } } : {}),
  };
  const [daily, puzzles, themes, profile, mySolved, myAttempts] = await Promise.all([
    puzzleOfTheDay(timezone),
    prisma.puzzle.findMany({ where, orderBy: [{ rating: "asc" }, { createdAt: "asc" }], take: 120, select: { id: true, title: true, fen: true, rating: true, difficulty: true, theme: true } }),
    prisma.puzzle.findMany({ where: { published: true, theme: { not: null } }, distinct: ["theme"], select: { theme: true } }),
    user ? prisma.memberProfile.findUnique({ where: { userId: user.id } }) : null,
    user ? prisma.puzzleAttempt.findMany({ where: { userId: user.id, solved: true }, distinct: ["puzzleId"], select: { puzzleId: true } }) : [],
    user ? prisma.puzzleAttempt.count({ where: { userId: user.id } }) : 0,
  ]);
  const stats = await puzzleStats(puzzles.map((p) => p.id));
  const solvedSet = new Set(mySolved.map((s) => s.puzzleId));
  const link = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams(Object.entries({ difficulty, theme: sp.theme, q, status: sp.status, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/puzzles${params.size ? `?${params}` : ""}`;
  };
  const chip = (active: boolean) => cn("whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition", active ? "border-brand bg-brand text-brand-foreground" : "border-border text-muted hover:text-foreground");

  return (
    <>
      <PageHero glyph="♞" eyebrow="Puzzle room" title="Sharpen your" highlight="tactics." body="Find the best move. Every solve updates your puzzle rating and streak." />
      <Container className="py-12">
        {user && (
          <div className="mb-12 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Puzzle rating" value={profile?.puzzleRating ?? 0} icon={<Trophy />} />
            <Stat label="Current streak" value={profile?.puzzleStreak ?? 0} hint={`Best ${profile?.puzzleBestStreak ?? 0}`} icon={<Flame />} />
            <Stat label="Puzzles solved" value={solvedSet.size} icon={<CheckCircle2 />} />
            <Stat label="Attempts" value={myAttempts} hint={myAttempts ? `${Math.round((solvedSet.size / Math.max(1, myAttempts)) * 100)}% success` : undefined} icon={<Target />} />
          </div>
        )}
        {daily && (
          <section className="mb-16">
            <div className="eyebrow mb-4">Puzzle of the day</div>
            <PuzzleSolver puzzle={daily} signedIn={Boolean(user)} />
          </section>
        )}
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            <Link href={link({ difficulty: undefined })} className={chip(!difficulty)}>All levels</Link>
            {DIFFICULTIES.map((d) => <Link key={d} href={link({ difficulty: d })} className={chip(difficulty === d)}>{humanize(d)}</Link>)}
            {themes.length > 0 && <span className="mx-1 w-px shrink-0 bg-border" />}
            {themes.map((t) => t.theme && <Link key={t.theme} href={link({ theme: sp.theme === t.theme ? undefined : t.theme })} className={chip(sp.theme === t.theme)}>{t.theme}</Link>)}
            {user && (
              <>
                <span className="mx-1 w-px shrink-0 bg-border" />
                <Link href={link({ status: sp.status === "unsolved" ? undefined : "unsolved" })} className={chip(sp.status === "unsolved")}>Unsolved</Link>
                <Link href={link({ status: sp.status === "solved" ? undefined : "solved" })} className={chip(sp.status === "solved")}>Solved</Link>
              </>
            )}
          </div>
          <form role="search" className="w-full lg:w-64">
            <input name="q" defaultValue={q} placeholder="Search puzzles…" className="h-11 w-full rounded-full border border-border bg-surface px-5 text-sm outline-none focus:border-brand" />
          </form>
        </div>
        {puzzles.length ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {puzzles.map((p) => {
              const s = stats.get(p.id);
              return (
                <Link key={p.id} href={`/puzzles/${p.id}`} className="group rounded-3xl border border-border bg-surface p-3 transition hover:-translate-y-1 hover:border-brand/50">
                  <div className="pointer-events-none"><ChessBoard fen={p.fen} orientation={p.fen.split(" ")[1] === "b" ? "black" : "white"} showCoordinates={false} className="rounded-xl" /></div>
                  <div className="px-1 pb-1 pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold group-hover:text-brand-ink">{p.title}</span>
                      {solvedSet.has(p.id) && <CheckCircle2 className="size-4 shrink-0 text-success" />}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                      <Badge variant="neutral">{p.rating}</Badge>
                      <span>{s ? `${Math.round((s.solved / s.attempts) * 100)}% of ${s.attempts}` : "No attempts yet"}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={<PuzzleIcon />} title="No puzzles found" description={difficulty || q || sp.theme || sp.status ? "Try another filter." : "Puzzles will appear here once the coaches publish them."} />
        )}
      </Container>
    </>
  );
}
