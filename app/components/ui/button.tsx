"use client";

import * as React from "react";
import { cn } from "../../lib/utils";

// Adapted from shadcn/ui's Button (pulled via the shadcn MCP), reworked to be
// dependency-free (no CVA/Radix) and wired to Reel's semantic theme tokens, so
// it works in both light and dark mode. Same variant/size API as shadcn's.

export type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive" | "link";
export type ButtonSize = "default" | "sm" | "lg" | "icon";

const base =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0";

const VARIANTS: Record<ButtonVariant, string> = {
  default:     "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary:   "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  outline:     "border border-border bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
  ghost:       "text-muted-foreground hover:bg-accent hover:text-foreground",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  link:        "text-primary underline-offset-4 hover:underline",
};

const SIZES: Record<ButtonSize, string> = {
  default: "h-9 px-4 py-2",
  sm:      "h-8 rounded-md px-3 text-xs",
  lg:      "h-11 rounded-xl px-6 text-base",
  icon:    "h-9 w-9",
};

export function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={cn(base, VARIANTS[variant], SIZES[size], className)} {...props} />;
}
