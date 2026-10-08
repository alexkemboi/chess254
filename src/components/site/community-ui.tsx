"use client";
import * as React from "react";
import { toast } from "sonner";
import { Bell, BellOff, Flag, Heart, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { commentAction, createPostAction, deleteOwnCommentAction, deleteOwnPostAction, reportAction, toggleFollowAction, toggleLikeAction } from "@/actions/community";
import { cn } from "@/lib/utils";

export function LikeButton({ postId, liked, count, signedIn }: { postId: string; liked: boolean; count: number; signedIn: boolean }) {
  const [state, setState] = React.useState({ liked, count });
  return (
    <button
      type="button"
      onClick={async () => {
        if (!signedIn) return toast.info("Sign in to like posts");
        const prev = state;
        setState({ liked: !state.liked, count: state.count + (state.liked ? -1 : 1) });
        const res = await toggleLikeAction(postId);
        if (res.ok && res.data) setState({ liked: res.data.liked, count: res.data.likes });
        else {
          setState(prev);
          if (!res.ok) toast.error(res.error);
        }
      }}
      className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition", state.liked ? "bg-danger/12 text-danger" : "text-muted hover:bg-white/5 hover:text-foreground")}
      aria-pressed={state.liked}
      aria-label="Like"
    >
      <Heart className={cn("size-4 transition-transform", state.liked && "scale-110 fill-current")} />
      {state.count}
    </button>
  );
}

export function FollowButton({ postId, following }: { postId: string; following: boolean }) {
  const [on, setOn] = React.useState(following);
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        const res = await toggleFollowAction(postId);
        if (res.ok && res.data) {
          setOn(res.data.following);
          toast.success(res.message);
        } else if (!res.ok) toast.error(res.error);
      }}
    >
      {on ? <BellOff /> : <Bell />}
      {on ? "Unfollow" : "Follow"}
    </Button>
  );
}

export function ShareButton({ title }: { title: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        const url = window.location.href;
        try {
          if (navigator.share) await navigator.share({ title, url });
          else {
            await navigator.clipboard.writeText(url);
            toast.success("Link copied");
          }
        } catch {
          /* user dismissed */
        }
      }}
    >
      <Share2 />Share
    </Button>
  );
}

export function ReportButton({ postId, commentId }: { postId?: string; commentId?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Report"><Flag /><span className="sr-only sm:not-sr-only">Report</span></Button>
      </DialogTrigger>
      <DialogContent title="Report content" description="Moderators will review this report. Thanks for keeping the clubhouse friendly.">
        <ActionForm action={(fd) => reportAction({ postId, commentId }, fd)} onSuccess={() => setOpen(false)} className="grid gap-4">
          <Field name="reason" label="What's wrong?"><Textarea name="reason" required maxLength={500} /></Field>
          <SubmitButton>Send report</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function DeletePostButton({ postId }: { postId: string }) {
  return (
    <ActionForm action={() => deleteOwnPostAction(postId)} confirm="Delete this post?">
      <SubmitButton variant="ghost" size="sm"><Trash2 />Delete</SubmitButton>
    </ActionForm>
  );
}

export function DeleteCommentButton({ commentId }: { commentId: string }) {
  return (
    <ActionForm action={() => deleteOwnCommentAction(commentId)} confirm="Delete this comment?">
      <button className="text-xs text-muted hover:text-danger">Delete</button>
    </ActionForm>
  );
}

export function CommentForm({ postId }: { postId: string }) {
  return (
    <ActionForm action={(fd) => commentAction(postId, fd)} resetOnSuccess className="grid gap-3">
      <Field name="body"><Textarea name="body" placeholder="Add to the discussion…" required maxLength={4000} className="min-h-24" /></Field>
      <div className="flex justify-end"><SubmitButton>Comment</SubmitButton></div>
    </ActionForm>
  );
}

export function NewPostForm({ defaultKind }: { defaultKind?: string }) {
  const [kind, setKind] = React.useState(defaultKind ?? "DISCUSSION");
  return (
    <ActionForm action={createPostAction} className="grid gap-5" successMessage={false}>
      <Field name="kind" label="Type">
        <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="DISCUSSION">Discussion</option>
          <option value="QUESTION">Question</option>
          <option value="GAME">Share a game</option>
          <option value="ACHIEVEMENT">Achievement</option>
          <option value="TOURNAMENT">Tournament talk</option>
        </Select>
      </Field>
      <Field name="title" label="Title"><Input name="title" required maxLength={140} /></Field>
      <Field name="body" label={kind === "QUESTION" ? "Your question" : "Post"} hint="Markdown supported."><Textarea name="body" required maxLength={10000} className="min-h-40" /></Field>
      {(kind === "GAME" || kind === "TOURNAMENT" || kind === "QUESTION") && (
        <Field name="pgn" label={`Game PGN${kind === "GAME" ? "" : " (optional)"}`} hint="Paste the PGN from Lichess, Chess.com or your scoresheet."><Textarea name="pgn" className="min-h-32 font-mono text-xs" placeholder={'[White "You"]\n1. e4 e5 2. Nf3 …'} /></Field>
      )}
      <SubmitButton size="lg" pendingLabel="Posting…">Publish</SubmitButton>
    </ActionForm>
  );
}
