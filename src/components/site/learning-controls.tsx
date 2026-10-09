"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bookmark, BookmarkCheck, CheckCircle2, Loader2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setProgressAction, toggleBookmarkAction } from "@/actions/learning";

export function LearningControls({ materialId, bookmarked, status }: { materialId: string; bookmarked: boolean; status: "NONE" | "IN_PROGRESS" | "COMPLETED" }) {
  const router = useRouter();
  const [saved, setSaved] = React.useState(bookmarked);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function progress(next: "IN_PROGRESS" | "COMPLETED") {
    setBusy(next);
    const res = await setProgressAction(materialId, next);
    setBusy(null);
    if (res.ok) {
      toast.success(res.message);
      router.refresh();
    } else toast.error(res.error);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === "NONE" && (
        <Button onClick={() => progress("IN_PROGRESS")} disabled={busy !== null}>{busy === "IN_PROGRESS" ? <Loader2 className="animate-spin" /> : <PlayCircle />}Start lesson</Button>
      )}
      {status !== "COMPLETED" ? (
        <Button variant={status === "NONE" ? "secondary" : "default"} onClick={() => progress("COMPLETED")} disabled={busy !== null}>{busy === "COMPLETED" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}Mark complete</Button>
      ) : (
        <span className="inline-flex h-11 items-center gap-2 rounded-full bg-success/12 px-5 text-sm font-semibold text-success"><CheckCircle2 className="size-4" />Completed</span>
      )}
      <Button
        variant="ghost"
        onClick={async () => {
          setSaved(!saved);
          const res = await toggleBookmarkAction(materialId);
          if (res.ok) toast.success(res.message);
          else {
            setSaved(saved);
            toast.error(res.error);
          }
        }}
        aria-pressed={saved}
      >
        {saved ? <BookmarkCheck className="text-brand-ink" /> : <Bookmark />}
        {saved ? "Saved" : "Save"}
      </Button>
    </div>
  );
}
