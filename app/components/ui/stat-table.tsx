"use client";

import { Fragment, type ReactNode } from "react";

// One table look for every stat surface in the app — game box scores,
// season ledgers, game logs — so numbers always read the same way:
// tabular figures that line up, the column leader emphasised, the player
// column pinned while the stats scroll sideways on a phone, and an optional
// team-totals footer.

export type StatCol<R> = {
  key: string;
  label: string;
  title?: string;
  value: (r: R) => ReactNode;
  // Numeric value used to find the column leader. Omit for columns where
  // "most" isn't "best" (turnovers, fouls, made–attempted pairs).
  lead?: (r: R) => number;
  muted?: boolean;
};

export function StatTable<R>({
  cols, rows, rowKey, name, footer, onRowClick, isHighlighted, isExpanded, renderExpanded, nameHeader = "Player", minWidth = 560, tone = "card",
}: {
  cols: StatCol<R>[];
  rows: R[];
  rowKey: (r: R) => string;
  name: (r: R) => ReactNode;
  footer?: { name: ReactNode; cells: ReactNode[] };
  onRowClick?: (r: R) => void;
  isHighlighted?: (r: R) => boolean;
  isExpanded?: (r: R) => boolean;
  renderExpanded?: (r: R) => ReactNode;
  nameHeader?: string;
  minWidth?: number;
  // "muted" when nested inside an expanded (grey) row, so the pinned column
  // matches its background instead of showing as a white block.
  tone?: "card" | "muted";
}) {
  const pin = tone === "muted" ? "bg-muted" : "bg-card";
  // Leader per column: the single highest value, only when it's above zero
  // and not tied — a "leader" among four players on 1 is noise.
  const leaders = cols.map(c => {
    if (!c.lead) return null;
    const vals = rows.map(c.lead);
    const max = Math.max(0, ...vals);
    return max > 0 && vals.filter(v => v === max).length === 1 ? max : null;
  });

  return (
    <div className="-mx-5 overflow-x-auto sm:-mx-6">
      <table className="w-full border-separate border-spacing-0 whitespace-nowrap text-right text-[13px] tabular-nums" style={{ minWidth }}>
        <thead>
          <tr className="text-[11px] text-muted-foreground">
            <th className={`sticky left-0 z-10 ${pin} py-2 pl-5 pr-3 text-left font-normal sm:pl-6`}>{nameHeader}</th>
            {cols.map((c, i) => (
              <th key={c.key} title={c.title} className={`px-2.5 py-2 font-normal ${i === cols.length - 1 ? "pr-5 sm:pr-6" : ""}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const hi = isHighlighted?.(r);
            const open = isExpanded?.(r);
            return (
              <Fragment key={rowKey(r)}>
                <tr onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={`group ${onRowClick ? "cursor-pointer" : ""}`}>
                  <td className={`sticky left-0 z-10 border-t border-border py-2.5 pl-5 pr-3 text-left sm:pl-6 ${hi ? "bg-muted" : pin} ${onRowClick ? "group-hover:bg-muted" : ""}`}>
                    {name(r)}
                  </td>
                  {cols.map((c, i) => {
                    const isLead = leaders[i] != null && c.lead!(r) === leaders[i];
                    return (
                      <td key={c.key}
                        className={`border-t border-border px-2.5 py-2.5 ${hi ? "bg-muted" : ""} ${onRowClick ? "group-hover:bg-muted" : ""} ${i === cols.length - 1 ? "pr-5 sm:pr-6" : ""} ${isLead ? "font-semibold text-foreground" : c.muted ? "text-muted-foreground" : "text-foreground/80"}`}>
                        {c.value(r)}
                      </td>
                    );
                  })}
                </tr>
                {open && renderExpanded && (
                  <tr><td colSpan={cols.length + 1} className="border-t border-border bg-muted p-0">{renderExpanded(r)}</td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        {footer && (
          <tfoot>
            <tr className="font-medium text-foreground">
              <td className={`sticky left-0 z-10 border-t-2 border-foreground/15 ${pin} py-2.5 pl-5 pr-3 text-left sm:pl-6`}>{footer.name}</td>
              {footer.cells.map((cell, i) => (
                <td key={i} className={`border-t-2 border-foreground/15 px-2.5 py-2.5 ${i === footer.cells.length - 1 ? "pr-5 sm:pr-6" : ""}`}>{cell}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// Section header used above every stat table.
export function StatHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-display text-xl text-foreground">{title}</h3>
        {sub && <div className="mt-1 text-[13px] text-muted-foreground">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

// "86% of points accounted for" — a thin meter instead of a warning badge.
export function CoverageMeter({ tracked, total, label }: { tracked: number; total: number; label?: string }) {
  if (total <= 0) return null;
  const pct = Math.min(100, Math.round((tracked / total) * 100));
  return (
    <div className="flex items-center gap-2.5 text-[12px] text-muted-foreground" title="Points in the box score vs points on the scoreboard">
      <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-foreground/70" style={{ width: `${pct}%` }} />
      </div>
      <span><span className="text-foreground">{Math.min(tracked, total)}</span> of {total} {label ?? "points"} tracked</span>
    </div>
  );
}

export const pctText = (made: number, att: number) => att > 0 ? `${Math.round((made / att) * 100)}%` : "—";
