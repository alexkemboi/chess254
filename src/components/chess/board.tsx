"use client";
import * as React from "react";
import { Chess, type Square } from "chess.js";
import { cn } from "@/lib/utils";

const GLYPHS: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

export type BoardMove = { from: string; to: string; promotion?: string };

type Props = {
  fen: string;
  orientation?: "white" | "black";
  interactive?: boolean;
  onMove?: (move: BoardMove) => void;
  lastMove?: { from: string; to: string } | null;
  highlight?: { square: string; tone: "good" | "bad" } | null;
  className?: string;
  showCoordinates?: boolean;
};

export function ChessBoard({ fen, orientation = "white", interactive = false, onMove, lastMove, highlight, className, showCoordinates = true }: Props) {
  const chess = React.useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return null;
    }
  }, [fen]);
  // Selection state is tied to the position it was made in, so a new FEN clears it without an effect.
  const [selection, setSelectionState] = React.useState<{ fen: string; square: string | null; promotion: BoardMove | null }>({ fen, square: null, promotion: null });
  const current = selection.fen === fen ? selection : { fen, square: null, promotion: null };
  const selected = current.square;
  const promotion = current.promotion;
  const setSelected = (square: string | null) => setSelectionState({ fen, square, promotion: null });
  const setPromotion = (p: BoardMove | null) => setSelectionState({ fen, square: null, promotion: p });

  if (!chess) return <div className={cn("grid aspect-square place-items-center rounded-2xl border border-border text-sm text-muted", className)}>Invalid position</div>;

  const board = chess.board();
  const ranks = orientation === "white" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const files = orientation === "white" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const targets = new Map<string, boolean>();
  if (selected) for (const m of chess.moves({ square: selected as Square, verbose: true })) targets.set(m.to, Boolean(m.captured));

  function click(square: string) {
    if (!interactive || !chess) return;
    const piece = chess.get(square as Square);
    if (selected && targets.has(square)) {
      const moving = chess.get(selected as Square);
      const isPromotion = moving?.type === "p" && (square[1] === "8" || square[1] === "1");
      if (isPromotion) setPromotion({ from: selected, to: square });
      else onMove?.({ from: selected, to: square });
      setSelected(null);
      return;
    }
    if (piece && piece.color === chess.turn()) setSelected(square === selected ? null : square);
    else setSelected(null);
  }

  return (
    <div className={cn("relative aspect-square w-full select-none overflow-hidden rounded-2xl border border-border-strong shadow-[0_30px_80px_-30px_rgba(0,0,0,.9)]", className)}>
      <div className="grid h-full w-full grid-cols-8 grid-rows-8">
        {ranks.map((r) =>
          files.map((f) => {
            const square = `${FILES[f]}${8 - r}`;
            const piece = board[r][f];
            const dark = (r + f) % 2 === 1;
            const isLast = lastMove && (lastMove.from === square || lastMove.to === square);
            const target = targets.get(square);
            return (
              <button
                type="button"
                key={square}
                onClick={() => click(square)}
                aria-label={`${square}${piece ? ` ${piece.color === "w" ? "white" : "black"} ${piece.type}` : ""}`}
                className={cn(
                  "relative grid place-items-center transition-colors",
                  dark ? "bg-[#2a6f7b]" : "bg-[#d9e7e4]",
                  isLast && (dark ? "bg-[#3d9aa0]" : "bg-[#b9e3dc]"),
                  selected === square && "bg-brand",
                  highlight?.square === square && (highlight.tone === "good" ? "bg-success" : "bg-danger"),
                  interactive ? "cursor-pointer" : "cursor-default",
                )}
              >
                {piece && (
                  <span
                    className={cn(
                      "pointer-events-none text-[min(9.4vw,3.4rem)] leading-none sm:text-[min(5.8vw,3.4rem)]",
                      piece.color === "w" ? "text-white [text-shadow:0_0_1px_#000,0_1px_2px_#000,0_0_3px_rgba(0,0,0,.6)]" : "text-[#0b0c0e] [text-shadow:0_0_1px_rgba(255,255,255,.55)]",
                    )}
                    style={{ fontFamily: "'Segoe UI Symbol','DejaVu Sans','Noto Sans Symbols 2',serif", fontVariantEmoji: "text" } as React.CSSProperties}
                  >
                    {GLYPHS[piece.type]}
                    {"︎"}
                  </span>
                )}
                {target !== undefined && (
                  <span className={cn("pointer-events-none absolute rounded-full", target ? "inset-1 border-4 border-black/30" : "size-[28%] bg-black/30")} />
                )}
                {showCoordinates && f === files[0] && <span className={cn("pointer-events-none absolute left-1 top-0.5 text-[9px] font-bold", dark ? "text-white/70" : "text-[#2a6f7b]")}>{8 - r}</span>}
                {showCoordinates && r === ranks[7] && <span className={cn("pointer-events-none absolute bottom-0 right-1 text-[9px] font-bold", dark ? "text-white/70" : "text-[#2a6f7b]")}>{FILES[f]}</span>}
              </button>
            );
          }),
        )}
      </div>
      {promotion && (
        <div className="absolute inset-0 grid place-items-center bg-black/70 backdrop-blur-sm">
          <div className="rounded-2xl border border-border bg-surface p-4 text-center">
            <div className="mb-3 text-sm font-semibold">Promote to</div>
            <div className="flex gap-2">
              {(["q", "r", "b", "n"] as const).map((p) => (
                <button key={p} type="button" className="grid size-14 place-items-center rounded-xl bg-surface-3 text-4xl hover:bg-brand hover:text-black" onClick={() => { onMove?.({ ...promotion, promotion: p }); setPromotion(null); }} aria-label={`Promote to ${p}`}>
                  {GLYPHS[p]}{"︎"}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
