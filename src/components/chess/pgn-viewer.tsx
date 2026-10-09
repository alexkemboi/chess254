"use client";
import * as React from "react";
import { Chess } from "chess.js";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Repeat } from "lucide-react";
import { ChessBoard } from "./board";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Steps through a PGN with buttons, move list and arrow keys. */
export function PgnViewer({ pgn, compact = false }: { pgn: string; compact?: boolean }) {
  const parsed = React.useMemo(() => {
    try {
      const game = new Chess();
      game.loadPgn(pgn);
      const history = game.history({ verbose: true });
      const headers = game.getHeaders();
      const replay = new Chess();
      const startFen = headers.FEN || replay.fen();
      if (headers.FEN) replay.load(headers.FEN);
      const fens = [startFen];
      for (const m of history) {
        replay.move(m.san);
        fens.push(replay.fen());
      }
      return { history, headers, fens };
    } catch {
      return null;
    }
  }, [pgn]);
  const [ply, setPly] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || !parsed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setPly((p) => Math.min(parsed.history.length, p + 1));
      if (e.key === "ArrowLeft") setPly((p) => Math.max(0, p - 1));
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [parsed]);

  if (!parsed) return <div className="rounded-2xl border border-border p-6 text-sm text-muted">This game could not be read.</div>;
  const { history, headers, fens } = parsed;
  const last = ply > 0 ? history[ply - 1] : null;

  return (
    <div ref={ref} tabIndex={0} className={cn("grid gap-5 outline-none", !compact && "lg:grid-cols-[minmax(0,1fr)_300px]")} aria-label="Game viewer. Use arrow keys to step through moves.">
      <div>
        {(headers.White || headers.Black) && (
          <div className="mb-3 flex items-center justify-between text-sm">
            <span><span className="font-semibold">{headers.White ?? "White"}</span> <span className="text-muted">vs</span> <span className="font-semibold">{headers.Black ?? "Black"}</span></span>
            {headers.Result && <span className="font-mono text-muted">{headers.Result}</span>}
          </div>
        )}
        <ChessBoard fen={fens[ply]} orientation={flipped ? "black" : "white"} lastMove={last ? { from: last.from, to: last.to } : null} />
        <div className="mt-3 flex items-center justify-center gap-1.5">
          <Button size="icon-sm" variant="secondary" onClick={() => setPly(0)} aria-label="Start"><ChevronFirst /></Button>
          <Button size="icon-sm" variant="secondary" onClick={() => setPly((p) => Math.max(0, p - 1))} aria-label="Previous move"><ChevronLeft /></Button>
          <span className="w-20 text-center font-mono text-xs text-muted">{ply}/{history.length}</span>
          <Button size="icon-sm" variant="secondary" onClick={() => setPly((p) => Math.min(history.length, p + 1))} aria-label="Next move"><ChevronRight /></Button>
          <Button size="icon-sm" variant="secondary" onClick={() => setPly(history.length)} aria-label="End"><ChevronLast /></Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setFlipped((f) => !f)} aria-label="Flip board"><Repeat /></Button>
        </div>
      </div>
      <div className="max-h-[480px] overflow-y-auto rounded-2xl border border-border bg-surface p-3">
        <ol className="grid grid-cols-[auto_1fr_1fr] gap-x-2 gap-y-0.5 font-mono text-sm">
          {Array.from({ length: Math.ceil(history.length / 2) }, (_, i) => (
            <React.Fragment key={i}>
              <span className="py-1 pr-1 text-right text-muted-2">{i + 1}.</span>
              {[0, 1].map((side) => {
                const idx = i * 2 + side;
                const m = history[idx];
                if (!m) return <span key={side} />;
                return (
                  <button key={side} type="button" onClick={() => setPly(idx + 1)} className={cn("rounded-md px-2 py-1 text-left hover:bg-foreground/5", ply === idx + 1 && "bg-brand text-brand-foreground hover:bg-brand")}>
                    {m.san}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </ol>
      </div>
    </div>
  );
}
