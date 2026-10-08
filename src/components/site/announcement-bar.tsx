"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";

const STORAGE_KEY = "c254-dismissed";

function readDismissed() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("c254-dismiss", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("c254-dismiss", onChange);
  };
}

type Item = { id: string; title: string; body: string | null; linkLabel: string | null; linkUrl: string | null };

/** Rotates through live announcements; dismissal is remembered per browser. */
export function AnnouncementBar({ items }: { items: Item[] }) {
  const [index, setIndex] = React.useState(0);
  const key = items.map((i) => i.id).join(",");
  const dismissed = React.useSyncExternalStore(subscribe, readDismissed, () => null);
  const hidden = dismissed === key;
  React.useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % items.length), 6000);
    return () => clearInterval(t);
  }, [items.length]);

  if (hidden || items.length === 0) return null;
  const item = items[index % items.length];
  return (
    <div className="relative z-50 bg-brand text-black">
      <div className="mx-auto flex min-h-10 max-w-7xl items-center justify-center gap-3 px-10 py-2 text-center text-[13px] font-bold">
        <span key={item.id} className="animate-fade-up">
          {item.title}
          {item.body && <span className="ml-2 hidden font-medium opacity-75 sm:inline">{item.body}</span>}
        </span>
        {item.linkUrl && (
          <Link href={item.linkUrl} className="inline-flex shrink-0 items-center gap-1 underline underline-offset-2">
            {item.linkLabel || "Learn more"} <ArrowRight className="size-3.5" />
          </Link>
        )}
        <button
          className="absolute right-3 rounded-full p-1 opacity-70 hover:bg-black/10 hover:opacity-100"
          aria-label="Dismiss announcement"
          onClick={() => {
            try {
              localStorage.setItem(STORAGE_KEY, key);
            } catch {}
            window.dispatchEvent(new Event("c254-dismiss"));
          }}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
