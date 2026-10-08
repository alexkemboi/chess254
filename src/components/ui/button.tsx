import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-brand text-brand-foreground hover:brightness-110 hover:shadow-[0_8px_30px_-6px_var(--brand)]",
        secondary: "bg-surface-2 text-foreground border border-border hover:border-border-strong hover:bg-surface-3",
        outline: "border border-border-strong text-foreground hover:border-brand hover:text-brand",
        ghost: "text-muted hover:text-foreground hover:bg-white/5",
        danger: "bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25",
        white: "bg-white text-black hover:bg-white/90",
        link: "text-brand underline-offset-4 hover:underline rounded-none px-0",
      },
      size: {
        default: "h-11 px-5 text-sm",
        sm: "h-9 px-4 text-[13px]",
        lg: "h-13 px-7 text-[15px]",
        icon: "size-10",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
