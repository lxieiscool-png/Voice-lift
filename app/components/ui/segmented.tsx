"use client";

import { cn } from "../../lib/utils";

// Compact segmented control — used for view switches (Film / Stats, Per game /
// Totals, team Stats / Games / Roster). One style everywhere so switching
// views always looks the same.
export function Segmented<T extends string>({ value, options, onChange, className }: {
  value: T;
  options: readonly { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("inline-flex rounded-lg border border-border p-0.5 text-xs font-semibold", className)}>
      {options.map(o => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors",
            value === o.value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          )}>
          {o.label}
          {o.count !== undefined && <span className="font-mono text-[10px] text-muted-foreground">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
