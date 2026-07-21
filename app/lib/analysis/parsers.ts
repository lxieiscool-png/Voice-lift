import type { PlayerDecision, GameReport, PlayerStat, TeamComparison } from "../types";

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
