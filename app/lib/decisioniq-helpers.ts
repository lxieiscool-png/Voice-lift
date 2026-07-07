import type { PlayerDecision } from "./types";

export const GRADE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "A+": { bg: "bg-emerald-500", text: "text-white",  border: "border-emerald-500" },
  "A":  { bg: "bg-emerald-500", text: "text-white",  border: "border-emerald-500" },
  "A-": { bg: "bg-emerald-400", text: "text-white",  border: "border-emerald-400" },
  "B+": { bg: "bg-zinc-100",    text: "text-zinc-900", border: "border-zinc-300"  },
  "B":  { bg: "bg-zinc-100",    text: "text-zinc-900", border: "border-zinc-300"  },
  "B-": { bg: "bg-zinc-200",    text: "text-zinc-900", border: "border-zinc-300"  },
  "C+": { bg: "bg-yellow-500",  text: "text-black",  border: "border-yellow-500"  },
  "C":  { bg: "bg-yellow-500",  text: "text-black",  border: "border-yellow-500"  },
  "C-": { bg: "bg-yellow-400",  text: "text-black",  border: "border-yellow-400"  },
  "D+": { bg: "bg-orange-500",  text: "text-white",  border: "border-orange-500"  },
  "D":  { bg: "bg-orange-500",  text: "text-white",  border: "border-orange-500"  },
  "D-": { bg: "bg-orange-400",  text: "text-white",  border: "border-orange-400"  },
  "F":  { bg: "bg-red-600",     text: "text-white",  border: "border-red-600"     },
};

export function gradeClass(grade: string, part: "bg" | "text" | "border") {
  return GRADE_COLORS[grade]?.[part] ?? (part === "bg" ? "bg-zinc-700" : part === "text" ? "text-white" : "border-zinc-700");
}

export const SPORT_ICONS: Record<string, string> = {
  basketball: "🏀", soccer: "⚽", football: "🏈", baseball: "⚾",
  hockey: "🏒", volleyball: "🏐", tennis: "🎾", rugby: "🏉",
  lacrosse: "🥍", "water polo": "🤽", swimming: "🏊", track: "🏃",
  wrestling: "🤼", boxing: "🥊", mma: "🥋", golf: "⛳",
};

export function sportIcon(sport: string): string {
  const key = (sport || "").toLowerCase().trim();
  for (const [k, v] of Object.entries(SPORT_ICONS)) if (key.includes(k)) return v;
  return "🎯";
}

export const TEAM_PALETTE = [
  { border: "border-l-blue-500",    bg: "bg-blue-500"    },
  { border: "border-l-red-500",     bg: "bg-red-500"     },
  { border: "border-l-emerald-500", bg: "bg-emerald-500" },
  { border: "border-l-purple-500",  bg: "bg-purple-500"  },
  { border: "border-l-amber-500",   bg: "bg-amber-500"   },
  { border: "border-l-pink-500",    bg: "bg-pink-500"    },
];

export function extractTeamName(player: string) {
  return player.match(/\(([^)]+)\)/)?.[1]?.trim().toLowerCase() ?? "__unknown__";
}

export function buildTeamColorMap(decisions: PlayerDecision[]) {
  const map = new Map<string, typeof TEAM_PALETTE[0]>();
  let idx = 0;
  for (const d of decisions) {
    const t = extractTeamName(d.player);
    if (!map.has(t)) { map.set(t, TEAM_PALETTE[idx % TEAM_PALETTE.length]); idx++; }
  }
  return map;
}

// Pull the jersey number out of a player string like "#23 Name (Team)" or "23 Name".
export function extractJersey(player: string): number | null {
  const m = player.match(/#?\s*(\d{1,2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

// Color a card by its jersey number so the same number always gets the same
// color, and players without a number stay neutral (no color).
export function jerseyColor(player: string): typeof TEAM_PALETTE[0] {
  const num = extractJersey(player);
  if (num === null) return { border: "border-l-zinc-700", bg: "bg-zinc-700" };
  return TEAM_PALETTE[num % TEAM_PALETTE.length];
}

export function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDate(ts: number) {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
