"use client";

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
  return (
    <div role="tablist" className={cn(stretch ? "flex w-full" : "inline-flex", "rounded-full bg-muted p-1 text-[13px]", className)}>
      {options.map(o => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cn(
            "flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 transition-all",
            stretch && "flex-1 py-2",
            value === o.value ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
          )}>
          {o.label}
          {o.count !== undefined && <span className="font-mono text-[10px] text-muted-foreground">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
