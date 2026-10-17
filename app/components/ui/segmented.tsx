"use client";

import { useId } from "react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

// Compact segmented control — used for view switches (Film / Stats, Per game /
// Totals, team Stats / Games / Roster). One style everywhere so switching
// views always looks the same.
export function Segmented<T extends string>({ value, options, onChange, className, stretch = false }: {
  value: T;
  options: readonly { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
  className?: string;
  // Fill the container width, options sharing it equally (form toggles).
  stretch?: boolean;
}) {
  // Each control needs its own layout group, or two segmented controls on the
  // same screen would fight over one shared thumb.
  const group = useId();
  return (
    <div role="tablist" className={cn(stretch ? "flex w-full" : "inline-flex", "rounded-full bg-muted p-1 text-[13px]", className)}>
      {options.map(o => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cn(
            "relative flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 transition-colors",
            stretch && "flex-1 py-2",
            value === o.value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}>
          {/* The thumb slides to the option you picked. */}
          {value === o.value && (
            <motion.span layoutId={`seg-${group}`} className="absolute inset-0 rounded-full bg-card shadow-soft"
              transition={{ type: "spring", stiffness: 420, damping: 36 }} />
          )}
          <span className="relative z-10 flex items-center gap-1.5">
            {o.label}
            {o.count !== undefined && <span className="font-mono text-[10px] text-muted-foreground">{o.count}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
