export const GRADE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "A+": { bg: "bg-emerald-500", text: "text-white",  border: "border-emerald-500" },
  "A":  { bg: "bg-emerald-500", text: "text-white",  border: "border-emerald-500" },
  "A-": { bg: "bg-emerald-400", text: "text-white",  border: "border-emerald-400" },
  "B+": { bg: "bg-blue-500",    text: "text-white",  border: "border-blue-500"    },
  "B":  { bg: "bg-blue-500",    text: "text-white",  border: "border-blue-500"    },
  "B-": { bg: "bg-blue-400",    text: "text-white",  border: "border-blue-400"    },
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

export const GRADE_VALUE: Record<string, number> = {
  "A+": 13, "A": 12, "A-": 11, "B+": 10, "B": 9, "B-": 8,
  "C+": 7, "C": 6, "C-": 5, "D+": 4, "D": 3, "D-": 2, "F": 1,
};

export const VALUE_GRADE: Record<number, string> = Object.fromEntries(
  Object.entries(GRADE_VALUE).map(([k, v]) => [v, k])
);

export function averageGrade(grades: string[]): string {
  const valid = grades.map(g => GRADE_VALUE[g]).filter(Boolean);
  if (!valid.length) return "N/A";
  const avg = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
  return VALUE_GRADE[Math.max(1, Math.min(13, avg))] ?? "N/A";
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

export function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDate(ts: number) {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
