"use client";
import * as React from "react";

type Point = { date: string; label: string; amount: number; display: string };

/** Single-series daily revenue bars with a hover tooltip and a table fallback. */
export function RevenueChart({ points, title }: { points: Point[]; title: string }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const [table, setTable] = React.useState(false);
  const max = Math.max(1, ...points.map((p) => p.amount));
  return (
    <figure>
      <figcaption className="mb-4 flex items-center justify-between gap-3">
        <span className="text-[15px] font-semibold">{title}</span>
        <button type="button" onClick={() => setTable(!table)} className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline">{table ? "Show chart" : "Show table"}</button>
      </figcaption>
      {table ? (
        <div className="max-h-64 overflow-y-auto text-sm">
          <table className="w-full">
            <tbody>{points.map((p) => <tr key={p.date} className="border-b border-border/60"><td className="py-1.5 text-muted">{p.label}</td><td className="py-1.5 text-right font-mono">{p.display}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <div className="flex h-48 items-end gap-[2px] border-b border-border" role="img" aria-label={`${title}. Highest day ${points.reduce((a, b) => (b.amount > a.amount ? b : a), points[0])?.display ?? 0}.`}>
            {points.map((p, i) => (
              <div key={p.date} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${p.label}: ${p.display}`}>
                <div className="w-full rounded-t-[4px] bg-brand transition-opacity" style={{ height: `${(p.amount / max) * 100}%`, minHeight: p.amount > 0 ? 3 : 0, opacity: hover === null || hover === i ? 1 : 0.45 }} />
              </div>
            ))}
          </div>
          {hover !== null && points[hover] && (
            <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-surface-3 px-2.5 py-1.5 text-xs shadow-xl" style={{ left: `${((hover + 0.5) / points.length) * 100}%` }}>
              <div className="text-muted">{points[hover].label}</div>
              <div className="font-mono font-semibold text-foreground">{points[hover].display}</div>
            </div>
          )}
          <div className="mt-2 flex justify-between text-[11px] text-muted-2"><span>{points[0]?.label}</span><span>{points.at(-1)?.label}</span></div>
        </div>
      )}
    </figure>
  );
}
