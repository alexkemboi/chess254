"use client";
import * as React from "react";
import { Dialog as D } from "radix-ui";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Img } from "@/components/ui/img";
import { cn } from "@/lib/utils";

type Photo = { id: string; title: string; caption: string | null; imageUrl: string; alt: string | null; width: number | null; height: number | null; category: string | null };

export function GalleryGrid({ photos }: { photos: Photo[] }) {
  const [index, setIndex] = React.useState<number | null>(null);
  const open = index !== null;
  const go = React.useCallback((d: number) => setIndex((i) => (i === null ? i : (i + d + photos.length) % photos.length)), [photos.length]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go]);

  const current = index !== null ? photos[index] : null;
  return (
    <>
      <div className="columns-2 gap-3 md:columns-3 lg:columns-4 [&>*]:mb-3">
        {photos.map((p, i) => (
          <button key={p.id} type="button" onClick={() => setIndex(i)} className="group relative block w-full overflow-hidden rounded-2xl bg-surface-2 text-left" style={{ aspectRatio: p.width && p.height ? `${p.width}/${p.height}` : "4/5" }}>
            <Img src={p.imageUrl} alt={p.alt || p.title} fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover transition duration-700 group-hover:scale-105" />
            <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
            <span className="absolute inset-x-3 bottom-3 translate-y-2 opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">
              {p.category && <span className="block text-[10px] font-bold uppercase tracking-widest text-brand">{p.category}</span>}
              <span className="text-sm font-semibold">{p.title}</span>
            </span>
          </button>
        ))}
      </div>
      <D.Root open={open} onOpenChange={(o) => !o && setIndex(null)}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 bg-black/95 backdrop-blur" />
          <D.Content className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 outline-none" aria-describedby={undefined}>
            <D.Title className="sr-only">{current?.title ?? "Photo"}</D.Title>
            {current && (
              <>
                <div className="relative h-[78dvh] w-full max-w-5xl">
                  <Img key={current.id} src={current.imageUrl} alt={current.alt || current.title} fill sizes="100vw" className="animate-fade-up object-contain" />
                </div>
                <div className="mt-4 text-center">
                  <div className="font-semibold">{current.title}</div>
                  {current.caption && <div className="text-sm text-muted">{current.caption}</div>}
                  <div className="mt-1 font-mono text-xs text-muted-2">{(index ?? 0) + 1} / {photos.length}</div>
                </div>
              </>
            )}
            {photos.length > 1 && (
              <>
                <button className={cn(navBtn, "left-3 sm:left-6")} onClick={() => go(-1)} aria-label="Previous photo"><ChevronLeft className="size-6" /></button>
                <button className={cn(navBtn, "right-3 sm:right-6")} onClick={() => go(1)} aria-label="Next photo"><ChevronRight className="size-6" /></button>
              </>
            )}
            <D.Close className="absolute right-4 top-4 rounded-full bg-white/10 p-2.5 hover:bg-white/20" aria-label="Close"><X className="size-5" /></D.Close>
          </D.Content>
        </D.Portal>
      </D.Root>
    </>
  );
}

const navBtn = "absolute top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-brand hover:text-black";
