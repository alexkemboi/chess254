import "server-only";
import { Chess } from "chess.js";
import { prisma } from "@/server/db";
import { UserError } from "@/server/errors";
import { dateKeyInZone } from "@/lib/time";

/** Plays a UCI move (e2e4, e7e8q) on a board; returns the SAN or null if illegal. */
export function playUci(chess: Chess, uci: string) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  try {
    const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return move?.san ?? null;
  } catch {
    return null;
  }
}

/** Validates FEN + solution line for the admin editor. */
export function validatePuzzleLine(fen: string, solution: string[]) {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return "The FEN is not a valid chess position.";
  }
  if (solution.length === 0) return "Add at least one solution move.";
  for (const [i, uci] of solution.entries()) {
    if (!playUci(chess, uci)) return `Move ${i + 1} (${uci}) is not legal in this line.`;
  }
  return null;
}

export type MoveCheck =
  | { correct: false; expected?: undefined }
  | { correct: true; done: boolean; reply?: string; replySan?: string };

/**
 * Checks the solver's next move against the stored line. The solution stays on
 * the server; any move that delivers mate is accepted as an alternative.
 */
export async function checkMove(puzzleId: string, played: string[]): Promise<MoveCheck> {
  const puzzle = await prisma.puzzle.findFirst({ where: { id: puzzleId, published: true } });
  if (!puzzle) throw new UserError("Puzzle not found.");
  const chess = new Chess(puzzle.fen);
  const solverMoves = played.length;
  if (solverMoves === 0 || solverMoves > Math.ceil(puzzle.solution.length / 2)) throw new UserError("Invalid move sequence.");
  // Replay earlier (already validated) solver moves with the stored replies.
  for (let i = 0; i < solverMoves - 1; i++) {
    const reply = puzzle.solution[i * 2 + 1];
    if (played[i] !== puzzle.solution[i * 2] || !reply) throw new UserError("Invalid move sequence.");
    playUci(chess, played[i]);
    playUci(chess, reply);
  }
  const move = played[solverMoves - 1];
  const expected = puzzle.solution[(solverMoves - 1) * 2];
  const probe = new Chess(chess.fen());
  if (!playUci(probe, move)) return { correct: false };
  const correct = move === expected || probe.isCheckmate();
  if (!correct) return { correct: false };
  const reply = probe.isCheckmate() ? undefined : puzzle.solution[(solverMoves - 1) * 2 + 1];
  const done = !reply || probe.isCheckmate();
  let replySan: string | undefined;
  if (reply) replySan = playUci(probe, reply) ?? undefined;
  return { correct: true, done, reply, replySan };
}

/** Records a finished attempt and updates rating (first attempt only) and solve streak. */
export async function recordAttempt(userId: string, puzzleId: string, input: { solved: boolean; moves: string[]; usedHint: boolean }) {
  const puzzle = await prisma.puzzle.findFirst({ where: { id: puzzleId, published: true } });
  if (!puzzle) throw new UserError("Puzzle not found.");
  return prisma.$transaction(async (tx) => {
    const prior = await tx.puzzleAttempt.count({ where: { userId, puzzleId } });
    await tx.puzzleAttempt.create({ data: { userId, puzzleId, solved: input.solved, moves: input.moves.slice(0, 40), usedHint: input.usedHint } });
    const profile = await tx.memberProfile.upsert({ where: { userId }, create: { userId }, update: {} });
    let rating = profile.puzzleRating;
    let delta = 0;
    if (prior === 0) {
      const expected = 1 / (1 + 10 ** ((puzzle.rating - rating) / 400));
      const score = input.solved && !input.usedHint ? 1 : 0;
      delta = Math.round(24 * (score - expected));
      rating = Math.max(100, rating + delta);
    }
    const streak = input.solved ? profile.puzzleStreak + 1 : 0;
    const updated = await tx.memberProfile.update({
      where: { userId },
      data: { puzzleRating: rating, puzzleStreak: streak, puzzleBestStreak: Math.max(profile.puzzleBestStreak, streak), lastPuzzleDay: new Date() },
    });
    return { rating: updated.puzzleRating, delta, streak: updated.puzzleStreak, best: updated.puzzleBestStreak, firstAttempt: prior === 0 };
  });
}

export async function puzzleStats(puzzleIds: string[]) {
  if (!puzzleIds.length) return new Map<string, { attempts: number; solved: number }>();
  const rows = await prisma.puzzleAttempt.groupBy({ by: ["puzzleId", "solved"], where: { puzzleId: { in: puzzleIds } }, _count: { _all: true } });
  const map = new Map<string, { attempts: number; solved: number }>();
  for (const r of rows) {
    const s = map.get(r.puzzleId) ?? { attempts: 0, solved: 0 };
    s.attempts += r._count._all;
    if (r.solved) s.solved += r._count._all;
    map.set(r.puzzleId, s);
  }
  return map;
}

/** Deterministic puzzle of the day across published puzzles. */
export async function puzzleOfTheDay(timezone: string) {
  const ids = await prisma.puzzle.findMany({ where: { published: true }, select: { id: true }, orderBy: { createdAt: "asc" } });
  if (!ids.length) return null;
  const key = dateKeyInZone(new Date(), timezone);
  const seed = [...key].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 7);
  return prisma.puzzle.findUnique({ where: { id: ids[seed % ids.length].id }, select: { id: true, title: true, fen: true, rating: true, difficulty: true, theme: true, hint: true, description: true } });
}

export function sideToMove(fen: string) {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}
