import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { currentUser } from "@/server/auth";
import { puzzleStats } from "@/server/puzzles";
import { Container } from "@/components/site/cards";
import { PuzzleSolver } from "@/components/chess/puzzle-solver";

async function load(id: string) {
  return prisma.puzzle.findFirst({ where: { id, published: true }, select: { id: true, title: true, fen: true, rating: true, difficulty: true, theme: true, description: true } });
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const p = await load((await params).id);
  return p ? { title: `${p.title} — puzzle`, description: p.description ?? `${p.theme ?? "Tactics"} puzzle rated ${p.rating}.`, alternates: { canonical: `/puzzles/${p.id}` } } : { title: "Puzzle not found" };
}

export default async function PuzzlePage({ params }: { params: Promise<{ id: string }> }) {
  const puzzle = await load((await params).id);
  if (!puzzle) notFound();
  const [user, next, stats] = await Promise.all([
    currentUser(),
    prisma.puzzle.findFirst({ where: { published: true, OR: [{ rating: { gt: puzzle.rating } }, { rating: puzzle.rating, id: { gt: puzzle.id } }] }, orderBy: [{ rating: "asc" }, { id: "asc" }], select: { id: true } }),
    puzzleStats([puzzle.id]),
  ]);
  const s = stats.get(puzzle.id);
  return (
    <Container className="max-w-6xl py-10 sm:py-14">
      <Link href="/puzzles" className="text-sm text-muted hover:text-foreground">← Puzzle room</Link>
      <div className="mt-6">
        <PuzzleSolver key={puzzle.id} puzzle={puzzle} signedIn={Boolean(user)} nextHref={next ? `/puzzles/${next.id}` : undefined} />
      </div>
      <p className="mt-6 text-sm text-muted">{s ? `Solved by ${s.solved} of ${s.attempts} attempts (${Math.round((s.solved / s.attempts) * 100)}%).` : "Be the first to solve this puzzle."}</p>
    </Container>
  );
}
