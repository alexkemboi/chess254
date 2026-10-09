"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <main className="grid min-h-[70dvh] place-items-center px-6 text-center">
      <div>
        <div className="font-display text-6xl text-brand-ink">♚</div>
        <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight">Something went wrong.</h1>
        <p className="mt-3 text-muted">An unexpected error occurred. Please try again.{error.digest ? ` (ref ${error.digest})` : ""}</p>
        <Button className="mt-8" onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
