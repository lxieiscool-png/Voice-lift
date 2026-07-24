"use client";

import { ReactNode } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { gradeClass, sportIcon } from "../lib/decisioniq-helpers";

// Stable per-team accent color from the team name, so the same team always
// gets the same avatar/dot color across the Library and Teams tab.
const AVATAR_PALETTE = [
  "bg-blue-600", "bg-red-600", "bg-emerald-600", "bg-purple-600",
  "bg-amber-600", "bg-pink-600", "bg-teal-600", "bg-indigo-600",
];
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
export function teamAvatarColor(key: string): string {
  return AVATAR_PALETTE[hashString(key || "team") % AVATAR_PALETTE.length];
}
export function teamInitials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "T";
}

// ─── Collapsible team section header ─────────────────────────────────────────

export function TeamSectionHeader({ name, initials, colorClass, badge, subtitle, record, recordTone = "neutral", open, onToggle, actions }: {
  name: string;
  initials: string;
  colorClass: string;
  badge?: string | null;
  subtitle?: string | null;
  record?: string | null;
  recordTone?: "win" | "loss" | "neutral";
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
}) {
  const recordColor =
    recordTone === "win" ? "text-emerald-400 border-emerald-900/60"
    : recordTone === "loss" ? "text-red-400 border-red-900/60"
    : "text-zinc-400 border-zinc-800";
  return (
    <div className="flex items-center gap-3 px-1 py-2">
      <button onClick={onToggle} className="flex flex-1 items-center gap-3 text-left min-w-0">
        <span className="text-zinc-500 shrink-0">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-black text-white ${colorClass}`}>
          {initials}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate text-base font-black text-white">{name}</span>
            {badge && <span className="shrink-0 rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{badge}</span>}
          </span>
          {subtitle && <span className="block truncate text-xs text-zinc-500 mt-0.5">{subtitle}</span>}
        </span>
      </button>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        {record && (
          <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${recordColor}`}>{record}</span>
        )}
      </div>
    </div>
  );
}

// ─── HoopIQ-style game card ──────────────────────────────────────────────────

export function GameCard({ thumbnailUrl, sport, dateLabel, title, grade, result, status, onClick, menu }: {
  thumbnailUrl?: string | null;
  sport: string;
  dateLabel: string;
  title: string;
  grade?: string | null;
  result?: { outcome: "W" | "L" | "T"; score: string | null } | null;
  status?: { label: string; tone: "processing" | "complete" | "failed" } | null;
  onClick?: () => void;
  menu?: ReactNode;
}) {
  const processing = status?.tone === "processing";
  const statusColor =
    status?.tone === "complete" ? "text-emerald-400 border-emerald-900/60 bg-emerald-950/30"
    : status?.tone === "failed" ? "text-red-400 border-red-900/60 bg-red-950/30"
    : "text-amber-400 border-amber-900/60 bg-amber-950/30";
  const resultColor =
    result?.outcome === "W" ? "bg-emerald-600 text-white"
    : result?.outcome === "L" ? "bg-red-600 text-white"
    : "bg-zinc-700 text-white";

  return (
    // No overflow-hidden on the root: the card's ⋮ menu is an absolutely
    // positioned dropdown that must be free to extend past the card edge.
    // Rounded-corner clipping lives on the thumbnail button instead.
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950">
      {/* Thumbnail */}
      <button onClick={onClick} disabled={!onClick} className="group relative block aspect-video w-full overflow-hidden rounded-t-2xl bg-gradient-to-br from-zinc-800 to-zinc-950 disabled:cursor-default">
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnailUrl} alt="" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-5xl opacity-20">{sportIcon(sport)}</span>
        )}
        <span className="absolute inset-0 bg-black/25 transition-colors group-hover:bg-black/10" />
        {/* Center anchor: grade badge, or a spinner while processing */}
        <span className="absolute inset-0 flex items-center justify-center">
          {processing ? (
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 backdrop-blur">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
            </span>
          ) : grade ? (
            <span className={`flex h-14 w-14 items-center justify-center rounded-full text-xl font-black shadow-lg ${gradeClass(grade, "bg")} ${gradeClass(grade, "text")}`}>
              {grade}
            </span>
          ) : null}
        </span>
      </button>

      {/* Meta */}
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs text-zinc-500 truncate">{dateLabel}</p>
          {menu}
        </div>
        <button onClick={onClick} disabled={!onClick} className="mt-1 block w-full text-left disabled:cursor-default">
          <p className="truncate text-sm font-bold text-white">{title}</p>
        </button>
        <div className="mt-2.5 flex items-center gap-2">
          {result && (
            <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-bold ${resultColor}`}>
              {result.outcome}{result.score ? ` ${result.score}` : ""}
            </span>
          )}
          {status && (
            <span className={`ml-auto rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusColor}`}>{status.label}</span>
          )}
        </div>
      </div>
    </div>
  );
}
