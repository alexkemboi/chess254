import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide whitespace-nowrap", {
  variants: {
    variant: {
      default: "bg-brand-soft text-brand-ink",
      neutral: "bg-foreground/6 text-muted",
      success: "bg-success/12 text-success",
      warning: "bg-warning/12 text-warning",
      danger: "bg-danger/12 text-danger",
      solid: "bg-brand text-brand-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

const STATUS_VARIANT: Record<string, VariantProps<typeof badgeVariants>["variant"]> = {
  ACTIVE: "success", CONFIRMED: "success", SUCCESS: "success", PAID: "success", PUBLISHED: "success", ATTENDED: "success", VISIBLE: "success", RESOLVED: "success", REVIEWED: "success", SENT: "success",
  COMPLETED: "neutral", REDEEMED: "neutral", EXPIRED: "neutral", REFUNDED: "neutral", INACTIVE: "neutral", ARCHIVED: "neutral", DISMISSED: "neutral", DRAFT: "neutral", SKIPPED: "neutral",
  PENDING: "warning", PROCESSING: "warning", OPEN: "warning", SUBMITTED: "warning", HIDDEN: "warning", QUEUED: "warning",
  ASSIGNED: "default", IN_PROGRESS: "default",
  FAILED: "danger", CANCELLED: "danger", NO_SHOW: "danger", REMOVED: "danger",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "neutral"} className={className}>
      {status.replace(/_/g, " ").toLowerCase()}
    </Badge>
  );
}
