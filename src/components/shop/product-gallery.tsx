"use client";
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Img as Image } from "@/components/ui/img";
import { ProductArt } from "./product-card";
import { cn } from "@/lib/utils";

export function ProductGallery({ images, name }: { images: { url: string; alt: string | null }[]; name: string }) {
  const [index, setIndex] = React.useState(0);
  const count = images.length;
  const go = (dir: number) => setIndex((i) => (i + dir + count) % count);
  if (!count) {
    return <div className="relative aspect-square overflow-hidden rounded-3xl border border-border"><ProductArt /></div>;
  }
  const current = images[index];
  return (
    <div className="grid gap-3">
      <div
        className="group relative aspect-square overflow-hidden rounded-3xl border border-border bg-white"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(1);
          if (e.key === "ArrowLeft") go(-1);
        }}
      >
        <Image key={current.url} src={current.url} alt={current.alt || name} fill priority sizes="(max-width: 1024px) 100vw, 50vw" className="animate-fade-up object-cover [animation-duration:.35s]" />
        {count > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className="absolute left-3 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white opacity-90 backdrop-blur transition hover:bg-black/75 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"><ChevronLeft className="size-5" /></button>
            <button type="button" onClick={() => go(1)} aria-label="Next photo" className="absolute right-3 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white opacity-90 backdrop-blur transition hover:bg-black/75 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"><ChevronRight className="size-5" /></button>
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-black/45 px-2.5 py-1.5 backdrop-blur sm:hidden">
              {images.map((img, i) => <span key={img.url} className={cn("size-1.5 rounded-full", i === index ? "bg-white" : "bg-white/40")} />)}
            </div>
          </>
        )}
      </div>
      {count > 1 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={img.url}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === index}
              className={cn("relative size-20 shrink-0 overflow-hidden rounded-2xl border-2 bg-white transition sm:size-24", i === index ? "border-brand" : "border-transparent opacity-70 hover:opacity-100")}
            >
              <Image src={img.url} alt="" fill sizes="96px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
