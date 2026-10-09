"use client";
import * as React from "react";
import Link from "next/link";
import { Chess } from "chess.js";
import { toast } from "sonner";
import { Check, Flame, Lightbulb, Loader2, RotateCcw, Trophy, X } from "lucide-react";
import { ChessBoard, type BoardMove } from "./board";
import { Button } from "@/components/ui/button";
import { checkPuzzleMoveAction, finishPuzzleAction, puzzleHintAction, type AttemptResult } from "@/actions/puzzles";
import { cn } from "@/lib/utils";

type Puzzle = { id: string; title: string; fen: string; rating: number; theme: string | null; difficulty: string; description?: string | null };

type Phase = "solving" | "waiting" | "wrong" | "solved";

export function PuzzleSolver({ puzzle, signedIn, compact = false, nextHref }: { puzzle: Puzzle; signedIn: boolean; compact?: boolean; nextHref?: string }) {
  const [fen, setFen] = React.useState(puzzle.fen);
  /** Solver moves only — replies are applied locally from the server response. */
  const [played, setPlayed] = React.useState<string[]>([]);
  const [phase, setPhase] = React.useState<Phase>("solving");
  const [lastMove, setLastMove] = React.useState<{ from: string; to: string } | null>(null);
  const [mark, setMark] = React.useState<{ square: string; tone: "good" | "bad" } | null>(null);
  const [hint, setHint] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<AttemptResult | null>(null);
  const finished = React.useRef(false);
  const orientation = puzzle.fen.split(" ")[1] === "b" ? "black" : "white";

  function reset() {
    finished.current = finished.current && phase === "solved";
    setFen(puzzle.fen);
    setPlayed([]);
    setPhase("solving");
    setLastMove(null);
    setMark(null);
  }

  async function finish(solved: boolean, moves: string[]) {
    if (finished.current) return;
    finished.current = true;
    const res = await finishPuzzleAction(puzzle.id, solved, moves, Boolean(hint));
    if (res.ok && res.data) setResult(res.data);
  }

  async function onMove(move: BoardMove) {
    if (phase !== "solving") return;
    const uci = `${move.from}${move.to}${move.promotion ?? ""}`;
    const board = new Chess(fen);
    try {
      board.move({ from: move.from, to: move.to, promotion: move.promotion });
    } catch {
      return;
    }
    const moves = [...played, uci];
    setFen(board.fen());
    setLastMove({ from: move.from, to: move.to });
    setPhase("waiting");
    const res = await checkPuzzleMoveAction(puzzle.id, moves);
    if (!res.ok || !res.data) {
      toast.error(res.ok ? "Could not check that move." : res.error);
      reset();
      return;
    }
    if (!res.data.correct) {
      setMark({ square: move.to, tone: "bad" });
      setPhase("wrong");
      void finish(false, moves);
      return;
    }
    setMark({ square: move.to, tone: "good" });
    setPlayed(moves);
    if (res.data.done) {
      setPhase("solved");
      void finish(true, moves);
      return;
    }
    const reply = res.data.reply!;
    setTimeout(() => {
      board.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
      setFen(board.fen());
      setLastMove({ from: reply.slice(0, 2), to: reply.slice(2, 4) });
      setMark(null);
      setPhase("solving");
    }, 450);
  }

  return (
    <div className={cn("grid gap-6", !compact && "lg:grid-cols-[minmax(0,1fr)_340px]")}>
      <ChessBoard fen={fen} orientation={orientation} interactive={phase === "solving"} onMove={(m) => void onMove(m)} lastMove={lastMove} highlight={mark} />
      <div className="flex flex-col gap-4">
        {!compact && (
          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="eyebrow">{puzzle.theme ?? "Puzzle"}</div>
            <h2 className="mt-2 font-display text-2xl font-extrabold tracking-tight">{puzzle.title}</h2>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
              <span className="rounded-full border border-border px-2.5 py-1">Rating {puzzle.rating}</span>
              <span className="rounded-full border border-border px-2.5 py-1 capitalize">{puzzle.difficulty.toLowerCase()}</span>
            </div>
            {puzzle.description && <p className="mt-3 text-sm text-muted">{puzzle.description}</p>}
          </div>
        )}
        <div
          className={cn(
            "rounded-2xl border p-5 transition-colors",
            phase === "solved" ? "border-success/40 bg-success/10" : phase === "wrong" ? "border-danger/40 bg-danger/10" : "border-border bg-surface",
          )}
          aria-live="polite"
        >
          <div className="flex items-center gap-3">
            <span className={cn("grid size-10 place-items-center rounded-full", phase === "solved" ? "bg-success text-black" : phase === "wrong" ? "bg-danger text-black" : "bg-surface-3")}>
              {phase === "solved" ? <Check className="size-5" /> : phase === "wrong" ? <X className="size-5" /> : phase === "waiting" ? <Loader2 className="size-5 animate-spin" /> : <span className={cn("size-4 rounded-full border-2", orientation === "white" ? "bg-white" : "bg-black")} />}
            </span>
            <div>
              <div className="font-semibold">
                {phase === "solved" ? "Solved!" : phase === "wrong" ? "Not quite." : phase === "waiting" ? "Checking…" : `${orientation === "white" ? "White" : "Black"} to move`}
              </div>
              <div className="text-xs text-muted">{phase === "solved" ? "Brilliant — that's the line." : phase === "wrong" ? "That's not the best move. Try again." : "Find the best move."}</div>
            </div>
          </div>
          {result?.recorded && result.rating !== undefined && (
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-background/60 p-3"><div className="flex items-center gap-1.5 text-xs text-muted"><Trophy className="size-3.5" />Puzzle rating</div><div className="mt-1 font-display text-xl font-extrabold">{result.rating}{result.delta ? <span className={cn("ml-1.5 text-sm", result.delta > 0 ? "text-success" : "text-danger")}>{result.delta > 0 ? "+" : ""}{result.delta}</span> : null}</div></div>
              <div className="rounded-xl bg-background/60 p-3"><div className="flex items-center gap-1.5 text-xs text-muted"><Flame className="size-3.5" />Streak</div><div className="mt-1 font-display text-xl font-extrabold">{result.streak}<span className="ml-1.5 text-xs font-medium text-muted">best {result.best}</span></div></div>
            </div>
          )}
          {!signedIn && phase !== "solving" && phase !== "waiting" && (
            <p className="mt-4 text-xs text-muted"><Link href="/login?next=/puzzles" className="text-brand-ink underline">Sign in</Link> to track your rating and streak.</p>
          )}
        </div>
        {hint && <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning"><Lightbulb className="mb-1 size-4" />{hint}</div>}
        <div className="flex flex-wrap gap-2">
          {(phase === "wrong" || phase === "solved") && (
            <Button variant="secondary" onClick={reset}><RotateCcw />{phase === "solved" ? "Replay" : "Try again"}</Button>
          )}
          {phase === "solving" && !hint && (
            <Button variant="ghost" onClick={async () => { const r = await puzzleHintAction(puzzle.id); if (r.ok && r.data) setHint(r.data); }}>
              <Lightbulb />Hint
            </Button>
          )}
          {nextHref && <Button asChild><Link href={nextHref}>Next puzzle</Link></Button>}
        </div>
      </div>
    </div>
  );
}
