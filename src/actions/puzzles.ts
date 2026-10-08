"use server";
import { z } from "zod";
import { currentUser } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import { checkMove, recordAttempt, type MoveCheck } from "@/server/puzzles";
import { rateLimit } from "@/server/rate-limit";
import { clientIp } from "@/server/audit";
import { prisma } from "@/server/db";

const uci = z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/);

export async function checkPuzzleMoveAction(puzzleId: string, moves: string[]): Promise<ActionResult<MoveCheck>> {
  return runAction(async () => {
    const parsed = z.object({ puzzleId: z.string().min(1).max(40), moves: z.array(uci).min(1).max(20) }).parse({ puzzleId, moves });
    const user = await currentUser();
    if (!(await rateLimit(`puzzle:${user?.id ?? await clientIp()}`, 240, 600))) return { ok: false, error: "Slow down a little — too many moves." };
    return { ok: true, data: await checkMove(parsed.puzzleId, parsed.moves) };
  });
}

export type AttemptResult = { recorded: boolean; rating?: number; delta?: number; streak?: number; best?: number };

export async function finishPuzzleAction(puzzleId: string, solved: boolean, moves: string[], usedHint: boolean): Promise<ActionResult<AttemptResult>> {
  return runAction<AttemptResult>(async () => {
    const user = await currentUser();
    if (!user) return { ok: true, data: { recorded: false } };
    const data = z.object({ puzzleId: z.string().min(1), solved: z.boolean(), moves: z.array(uci).max(20), usedHint: z.boolean() }).parse({ puzzleId, solved, moves, usedHint });
    // A "solved" claim is only accepted if the server can replay the full line.
    let verified = false;
    if (data.solved && data.moves.length) {
      const result = await checkMove(data.puzzleId, data.moves).catch(() => null);
      verified = Boolean(result?.correct && result.done);
    }
    const r = await recordAttempt(user.id, data.puzzleId, { solved: verified, moves: data.moves, usedHint: data.usedHint });
    return { ok: true, data: { recorded: true, ...r } };
  });
}

export async function puzzleHintAction(puzzleId: string): Promise<ActionResult<string>> {
  return runAction(async () => {
    const p = await prisma.puzzle.findFirst({ where: { id: puzzleId, published: true }, select: { hint: true, solution: true } });
    if (!p) return { ok: false, error: "Puzzle not found." };
    return { ok: true, data: p.hint || `Look at the piece on ${p.solution[0].slice(0, 2)}.` };
  });
}
