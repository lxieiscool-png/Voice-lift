import type { PlayerDecision, GameReport, PlayerStat, TeamComparison, PlayerBoxStat } from "../types";

const STAT_EVENTS = new Set([
  "made_2", "made_3", "missed_2", "missed_3", "made_ft", "missed_ft",
  "rebound", "assist", "steal", "turnover", "block", "foul",
]);

const COLOR_WORDS = new Set([
  "white", "black", "gray", "grey", "silver", "red", "scarlet", "crimson", "maroon", "burgundy",
  "blue", "navy", "teal", "cyan", "green", "olive", "lime", "yellow", "gold", "orange",
  "purple", "violet", "pink", "magenta", "brown", "tan", "home", "away",
]);

function emptyBoxStat(player: string, team: string, jersey: string | null): PlayerBoxStat {
  return { player, team, jersey, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, tov: 0, blk: 0, pf: 0 };
}

// Tally a box score deterministically from the per-segment "Stat Events" lines.
// We do the counting in code rather than asking the model to sum across dozens
// of segments — LLMs are unreliable at arithmetic over long lists. Time chunks
// don't overlap, so summing per-segment events avoids double counting.
export function buildBoxScore(chunkTexts: string[]): PlayerBoxStat[] {
  const byKey = new Map<string, PlayerBoxStat>();

  for (const text of chunkTexts) {
    // Only scan lines inside a "Stat Events:" section so we don't misread other
    // lines that happen to contain a pipe.
    const section = text.match(/Stat Events:\s*([\s\S]*?)(?=\n[A-Z][\w &/]+:|===|$)/i)?.[1] ?? "";
    for (const rawLine of section.split("\n")) {
      const line = rawLine.replace(/^[-•*]\s*/, "").trim();
      const m = line.match(/^(.+?)\s*\|\s*([a-z_2-3]+)\b/i);
      if (!m) continue;
      const event = m[2].toLowerCase();
      if (!STAT_EVENTS.has(event)) continue;

      const label = m[1].trim();
      const jersey = label.match(/#\s*(\d{1,2})/)?.[1] ?? null;
      const firstWord = label.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
      const team = COLOR_WORDS.has(firstWord) ? firstWord : "unknown";
      const key = `${team}#${jersey ?? label.toLowerCase()}`;
      const display = jersey ? `${team === "unknown" ? "" : team[0].toUpperCase() + team.slice(1) + " "}#${jersey}`.trim() : label;

      if (!byKey.has(key)) byKey.set(key, emptyBoxStat(display, team, jersey));
      const s = byKey.get(key)!;

      switch (event) {
        case "made_2":   s.fgm++; s.fga++; s.pts += 2; break;
        case "missed_2": s.fga++; break;
        case "made_3":   s.fgm++; s.fga++; s.tpm++; s.tpa++; s.pts += 3; break;
        case "missed_3": s.fga++; s.tpa++; break;
        case "made_ft":  s.ftm++; s.fta++; s.pts += 1; break;
        case "missed_ft": s.fta++; break;
        case "rebound":  s.reb++; break;
        case "assist":   s.ast++; break;
        case "steal":    s.stl++; break;
        case "turnover": s.tov++; break;
        case "block":    s.blk++; break;
        case "foul":     s.pf++; break;
      }
    }
  }

  // Drop rows with no meaningful production, then sort by points.
  return [...byKey.values()]
    .filter(s => s.pts || s.fga || s.reb || s.ast || s.stl || s.tov || s.blk || s.pf)
    .sort((a, b) => b.pts - a.pts || b.fga - a.fga);
}

export function extractGrade(text: string) {
  return text.match(/(?:Overall\s+)?Decision\s+Grade:\s*([A-F][+-]?)/i)?.[1] ?? "N/A";
}

export function parsePlayerBlocks(text: string): PlayerDecision[] {
  return text.split(/===\s*PLAYER\s*===/i).slice(1).map((block) => {
    const clean = block.replace(/===\s*END\s*===/i, "").trim();
    const field   = (l: string) => clean.match(new RegExp(`^${l}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";
    const section = (l: string) => clean.match(new RegExp(`${l}:\\s*([\\s\\S]*?)(?=\\n[A-Z][\\w ]+:|===|$)`, "i"))?.[1]?.trim() ?? "";
    return {
      player: field("Player"), role: field("Role"), action: field("Action"),
      sport: field("Sport"), grade: field("Decision Grade"),
      whatHappened: section("What Happened"), decisionRead: section("Decision Read"),
      bestAlternative: section("Best Alternative"), whyBetter: section("Why It Was Better"),
      otherOptions: section("Other Options").split("\n").map(l => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean),
      patternToImprove: section("Pattern To Improve"), practiceFocus: section("Practice Focus"),
    };
  }).filter(d => d.player || d.whatHappened);
}

export function parseGameReport(text: string): GameReport {
  const extract     = (label: string) => text.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n[A-Z#][\\w &]+:|$)`, "i"))?.[1]?.trim() ?? "";
  const extractList = (label: string) => extract(label).split("\n").map(l => l.replace(/^[-•*\d.]\s*/, "").trim()).filter(Boolean);
  const playerStats: PlayerStat[] = extract("Player Stats")
    .split("\n").map(l => l.replace(/^[-•*]\s*/, "").trim())
    .filter(l => l && !l.toLowerCase().includes("no jersey") && !l.toLowerCase().includes("no players"))
    .map(l => ({ label: l.split("|")[0].replace(/\([^)]*\)/, "").trim() || l.slice(0, 20), raw: l }));
  return {
    overallGrade: extractGrade(text),
    gameSummary: extract("Game Summary"), periodBreakdown: extract("Period Breakdown"),
    foulPatterns: extract("Foul & Call Patterns"), decisionTrends: extract("Decision Trends"),
    strengths: extractList("Top 3 Strengths"), improvements: extractList("Top 3 Areas To Improve"),
    practiceFocus: extract("Game-Level Practice Focus"), playerStats,
    teamComparison: parseTeamComparison(text),
  };
}

export function isEmptyGameReport(r: GameReport | null): boolean {
  if (!r) return true;
  const hasText = r.gameSummary || r.periodBreakdown || r.foulPatterns || r.decisionTrends || r.practiceFocus;
  return !hasText && r.strengths.length === 0 && r.improvements.length === 0 && r.playerStats.length === 0;
}

function parseTeamComparison(text: string): TeamComparison | null {
  const block = text.match(/Team Comparison:\s*([\s\S]*)$/i)?.[1];
  if (!block) return null;
  const teams = block.match(/Teams:\s*(.+?)\s+vs\.?\s+(.+)/i);
  if (!teams) return null;

  const scoreRaw  = block.match(/Score:\s*(.+)/i)?.[1]?.trim() ?? "";
  const winnerRaw = block.match(/Winner:\s*(.+)/i)?.[1]?.trim() ?? "";
  const stats = block.split("\n")
    .map(l => l.replace(/^[-•*]\s*/, "").trim())
    .map(l => l.match(/^(.+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map(m => ({ label: m[1].trim(), a: parseInt(m[2], 10), b: parseInt(m[3], 10) }));

  return {
    teamA: teams[1].trim(), teamB: teams[2].trim(),
    score:  /not visible|n\/a|unknown/i.test(scoreRaw) || !scoreRaw ? null : scoreRaw,
    winner: /unclear|n\/a|unknown/i.test(winnerRaw)    || !winnerRaw ? null : winnerRaw,
    stats,
    why: block.match(/Why:\s*([\s\S]*?)$/i)?.[1]?.trim() ?? "",
  };
}
