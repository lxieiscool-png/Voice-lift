import type { GameReport, GameScoreboard, PlayerBoxStat, TeamTotals } from "../types";
import { buildBoxScore, buildVolleyBoxScore, buildDecisionTimeline, parsePlayerLabel, teamKeysFromColor } from "./parsers";

// Accuracy passes that run over the raw window texts BEFORE any tally, and
// over the tallies afterwards. The model works one window at a time, so it
// can't keep labels consistent across a game ("Anaheim Select #10" in one
// window, "Blue #10" in the next, a bare "#10" in a third) — every variant
// became its own box-score row and its own player. Fixing that here, in code,
// is cheaper and more reliable than asking the model to try harder.

export type GameTeamsHint = { teamColor?: string | null; teamName?: string | null; opponentName?: string | null; teamsNote?: string | null };

const LABEL_LINE = [
  // Player Tracking: "- Blue #12 Guard: ..."
  /^(\s*-\s*)([^:|]+?)(:\s)/,
  // Stat Events: "- Blue #12 | made_2"
  /^(\s*-\s*)([^:|]+?)(\s*\|\s*[a-z_]+\s*$)/,
  // Decision Events: "- 3:14 | Blue #12 | good | ..."
  /^(\s*-\s*\d{1,2}:\d{2}(?::\d{2})?\s*\|\s*)([^|]+?)(\s*\|)/,
];

function norm(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

// "Anaheim select" (user-typed) vs "Anaheim Select" (scoreboard) vs
// "Anaheim" — same team. Match on the first word, which is what differs
// between two teams in practice.
function sameTeamName(a: string, b: string) {
  const x = norm(a).split(" ")[0], y = norm(b).split(" ")[0];
  return !!x && !!y && x.length >= 3 && (x.startsWith(y) || y.startsWith(x));
}

function scoreLines(text: string, label: "Score Start" | "Score End" | "Score") {
  return text.match(new RegExp(`^${label}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";
}

// "Gray 12 – Blue 18 [Titanium – Anaheim Select]" -> sides with colour, score, name.
function parseScoreLine(line: string): { side: string; score: number }[] | null {
  if (!line || /unclear|not visible|n\/a|unknown/i.test(line)) return null;
  const [main, bracket] = line.split("[");
  const m = main.match(/^(.+?)\s+(\d{1,3})\s*[–\-:]\s*(.+?)\s+(\d{1,3})\s*$/);
  if (!m) return null;
  const names = bracket?.replace("]", "").split(/\s*[–\-]\s*/) ?? [];
  return [
    { side: m[1].trim(), score: +m[2], name: names[0]?.trim() },
    { side: m[3].trim(), score: +m[4], name: names[1]?.trim() },
  ] as { side: string; score: number; name?: string }[];
}

export type TeamResolution = { colors: string[]; names: Record<string, string> };

// Work out the game's two team colours and each one's real name.
export function resolveTeams(chunkTexts: string[], hint: GameTeamsHint): TeamResolution {
  const counts = new Map<string, number>();
  for (const text of chunkTexts) {
    for (const line of text.split("\n")) {
      for (const re of LABEL_LINE) {
        const m = line.match(re);
        if (!m) continue;
        const { team } = parsePlayerLabel(m[2].trim());
        if (team !== "unknown") counts.set(team, (counts.get(team) ?? 0) + 1);
        break;
      }
    }
  }
  const mine = teamKeysFromColor(hint.teamColor).find(c => counts.has(c)) ?? teamKeysFromColor(hint.teamColor)[0];
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const colors = mine ? [mine, ...ranked.filter(c => c !== mine)].slice(0, 2) : ranked.slice(0, 2);

  const names: Record<string, string> = {};
  // The scoreboard pairs colours with names directly: "Gray 12 – Blue 18 [Titanium – Anaheim Select]".
  for (const text of chunkTexts) {
    for (const label of ["Score Start", "Score End"] as const) {
      for (const side of (parseScoreLine(scoreLines(text, label)) ?? []) as { side: string; name?: string }[]) {
        const c = parsePlayerLabel(side.side).team;
        if (side.name && colors.includes(c) && !names[c]) names[c] = side.name;
      }
    }
  }
  // "Titanium (Gray) vs Anaheim Select (Blue)" style notes.
  for (const m of (hint.teamsNote ?? "").matchAll(/([A-Za-z][\w .'&-]*?)\s*\(\s*([A-Za-z ]+)\s*\)/g)) {
    const c = teamKeysFromColor(m[2])[0];
    if (c && colors.includes(c) && !names[c]) names[c] = m[1].trim();
  }
  // The uploader's own team and the opponent they typed in.
  if (colors[0] && hint.teamName && !names[colors[0]]) names[colors[0]] = hint.teamName;
  if (colors[1] && hint.opponentName && !names[colors[1]]) names[colors[1]] = hint.opponentName;
  return { colors, names };
}

// Rewrite every player label to "Colour #N ..." against the game's two teams.
export function normalizeGameTexts(chunkTexts: string[], teams: TeamResolution): string[] {
  const { colors, names } = teams;
  if (colors.length === 0) return chunkTexts;
  const nameToColor = (prefix: string) =>
    colors.find(c => names[c] && sameTeamName(prefix, names[c]));

  // Which jerseys each team is seen wearing, so a label with a missing or
  // off-colour team can be placed when its number exists on only one side.
  const jerseys = new Map<string, Set<string>>(colors.map(c => [c, new Set<string>()]));
  const fix = (label: string): string => {
    const m = label.match(/^(.*?)\s*#\s*(\d{1,2})(.*)$/);
    const prefix = (m ? m[1] : label.split(/\s+/)[0]).trim();
    const rest = m ? `#${m[2]}${m[3]}` : label.slice(prefix.length).trim();
    let color = parsePlayerLabel(prefix || "x").team;
    if (!colors.includes(color)) color = nameToColor(prefix) ?? color;
    if (!colors.includes(color) && m) {
      const owners = colors.filter(c => jerseys.get(c)!.has(m[2]));
      if (owners.length === 1) color = owners[0];
    }
    if (!colors.includes(color)) return m ? rest : label; // leave genuinely unknown ones alone
    return `${color[0].toUpperCase()}${color.slice(1)} ${rest}`.trim();
  };

  // Pass 1: learn jersey sets from labels whose colour is already clean.
  for (const text of chunkTexts) for (const line of text.split("\n")) for (const re of LABEL_LINE) {
    const m = line.match(re); if (!m) continue;
    const { team, jersey } = parsePlayerLabel(m[2].trim());
    if (jersey && colors.includes(team)) jerseys.get(team)!.add(jersey);
    break;
  }
  // Also count team-name labels ("Titanium #35") once names are known.
  for (const text of chunkTexts) for (const line of text.split("\n")) for (const re of LABEL_LINE) {
    const m = line.match(re); if (!m) continue;
    const lm = m[2].match(/^(.*?)\s*#\s*(\d{1,2})/);
    const c = lm ? nameToColor(lm[1]) : undefined;
    if (lm && c) jerseys.get(c)!.add(lm[2]);
    break;
  }

  // Pass 2: rewrite.
  return chunkTexts.map(text => text.split("\n").map(line => {
    for (const re of LABEL_LINE) {
      const m = line.match(re);
      if (m) return line.replace(re, `$1${fix(m[2].trim())}$3`);
    }
    return line;
  }).join("\n"));
}

// Sum the box score per team colour.
export function buildTeamTotals(rows: PlayerBoxStat[], colors: string[]): TeamTotals[] {
  return colors.map(color => {
    const t: TeamTotals = { color, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, tov: 0, blk: 0, pf: 0 };
    for (const r of rows) if (r.team === color) {
      for (const k of ["pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "reb", "ast", "stl", "tov", "blk", "pf"] as const) t[k] += r[k];
    }
    return t;
  });
}

// Read the in-video scoreboard across windows. This is the answer key: the
// box score is only as good as the baskets the model noticed, and comparing
// the two per window shows exactly where it missed some.
export function buildScoreboard(chunkTexts: string[], teams: TeamResolution): GameScoreboard | null {
  const { colors, names } = teams;
  if (colors.length < 2) return null;
  const read = (line: string): Record<string, number> | null => {
    const sides = parseScoreLine(line);
    if (!sides) return null;
    const out: Record<string, number> = {};
    for (const s of sides) {
      let c = parsePlayerLabel(s.side).team;
      if (!colors.includes(c)) c = colors.find(k => names[k] && sameTeamName(s.side, names[k])) ?? c;
      if (colors.includes(c)) out[c] = s.score;
    }
    return Object.keys(out).length === 2 ? out : null;
  };

  const windows = chunkTexts.map((text, index) => {
    const start = read(scoreLines(text, "Score Start")) ?? null;
    const end = read(scoreLines(text, "Score End") || scoreLines(text, "Score")) ?? null;
    const box = buildBoxScore([text]);
    const tracked: Record<string, number> = {};
    for (const c of colors) tracked[c] = box.filter(r => r.team === c).reduce((n, r) => n + r.pts, 0);
    return { index, start, end, tracked };
  });

  // Scores only go up. A reading lower than one already accepted is a
  // misread (a glare-washed digit, a replay graphic) — drop it.
  const best: Record<string, number> = {};
  let first: Record<string, number> | null = null;
  let last: Record<string, number> | null = null;
  for (const w of windows) {
    for (const r of [w.start, w.end]) {
      if (!r) continue;
      if (colors.some(c => r[c] < (best[c] ?? 0))) continue;
      for (const c of colors) best[c] = r[c];
      first ??= r;
      last = r;
    }
  }
  if (!last || !first) return null;
  const final = last, opening = first;
  return {
    teams: colors.map(color => ({ color, name: names[color] ?? null, final: final[color], start: opening[color] })),
    windows: windows.map(w => ({
      index: w.index,
      scored: w.start && w.end ? Object.fromEntries(colors.map(c => [c, w.end![c] - w.start![c]])) : null,
      tracked: w.tracked,
    })),
  };
}

export type PreparedGame = { rawTexts: string[]; texts: string[]; teams: TeamResolution; scoreboard: GameScoreboard | null };

// Everything deterministic that runs between the windows and the synthesis:
// clean labels, then read the scoreboard off the cleaned texts.
export function prepareGame(rawTexts: string[], hint: GameTeamsHint): PreparedGame {
  const teams = resolveTeams(rawTexts, hint);
  let texts = normalizeGameTexts(rawTexts, teams);
  let scoreboard = buildScoreboard(texts, teams);
  if (scoreboard) {
    texts = assignUnknownScorers(texts, scoreboard, teams);
    scoreboard = buildScoreboard(texts, teams);
  }
  return { rawTexts, texts, teams, scoreboard };
}

const POINTS: Record<string, number> = { made_2: 2, made_3: 3, made_ft: 1 };

// A made basket whose team couldn't be placed ("Black #6" when both teams
// have a #6) counts for nobody. The scoreboard settles it: if exactly one
// team is short by at least that many points in that window, it was theirs.
function assignUnknownScorers(texts: string[], sb: GameScoreboard, teams: TeamResolution): string[] {
  return texts.map((text, i) => {
    const w = sb.windows[i];
    if (!w?.scored) return text;
    const short: Record<string, number> = {};
    for (const c of teams.colors) short[c] = w.scored[c] - w.tracked[c];
    return text.split("\n").map(line => {
      const m = line.match(/^(\s*-\s*(?:\d{1,2}:\d{2}(?::\d{2})?\s*\|\s*)?)([^|]+?)(\s*\|\s*(made_2|made_3|made_ft)\s*)$/);
      if (!m) return line;
      const { team } = parsePlayerLabel(m[2].trim());
      if (teams.colors.includes(team)) return line;
      const pts = POINTS[m[4]];
      const owners = teams.colors.filter(c => short[c] >= pts);
      if (owners.length !== 1) return line;
      short[owners[0]] -= pts;
      const jersey = m[2].match(/#\s*(\d{1,2})/)?.[1];
      return `${m[1]}${cap(owners[0])} ${jersey ? `#${jersey}` : "Unknown"}${m[3]}`;
    }).join("\n");
  });
}

// Windows whose logged points don't match the scoreboard — candidates for a
// second look.
export function mismatchedWindows(g: PreparedGame): { index: number; scored: Record<string, number>; logged: Record<string, number> }[] {
  return (g.scoreboard?.windows ?? [])
    .filter(w => w.scored && g.teams.colors.some(c => w.scored![c] !== w.tracked[c]))
    .map(w => ({ index: w.index, scored: w.scored!, logged: w.tracked }));
}

// Named scoring events in one window: "gray#8|made_2" -> count.
function namedScoring(text: string, colors: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of buildBoxScore([text])) {
    if (!r.jersey || !colors.includes(r.team)) continue;
    const add = (k: string, n: number) => { if (n > 0) out.set(`${r.team}#${r.jersey}|${k}`, n); };
    add("2", r.fgm - r.tpm); add("3", r.tpm); add("ft", r.ftm);
  }
  return out;
}

// Take a second look only when it is strictly better: it must match the
// scoreboard, and it may not take points away from a player the first pass
// named (unless the first pass over-counted that team). A second look that
// fixes the team total by moving a named player's basket to "Unknown" makes
// the player stats worse, which is the part athletes actually read.
export function acceptSecondLook(first: string, second: string, windowIndex: number, g: PreparedGame): boolean {
  const { teams } = g;
  const [a, b] = [normalizeGameTexts([first], teams)[0], normalizeGameTexts([second], teams)[0]];
  const w = g.scoreboard?.windows[windowIndex];
  if (!w?.scored) return false;
  const secondBox = buildBoxScore([b]);
  const matches = teams.colors.every(c => secondBox.filter(r => r.team === c).reduce((n, r) => n + r.pts, 0) === w.scored![c]);
  if (!matches) return false;
  const before = namedScoring(a, teams.colors), after = namedScoring(b, teams.colors);
  for (const [k, n] of before) {
    const team = k.split("#")[0];
    if (w.tracked[team] > w.scored[team]) continue; // first pass over-counted this team; let the recount stand
    if ((after.get(k) ?? 0) < n) return false;
  }
  return true;
}

const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;
function teamLabel(teams: TeamResolution, color: string) {
  const name = teams.names[color];
  return name ? `${name} (${cap(color)})` : cap(color);
}

// Hard facts for the synthesis prompt, so the written "why they won" and
// grades are anchored to the real score and counted stats instead of the
// model re-reading 20 window texts and estimating.
export function gameFactsForPrompt(g: PreparedGame): string {
  const { teams, scoreboard } = g;
  if (teams.colors.length < 2) return "";
  const box = buildBoxScore(g.texts);
  const totals = buildTeamTotals(box, teams.colors);
  const lines = totals.map(t =>
    `${teamLabel(teams, t.color)}: ${t.fgm}/${t.fga} FG, ${t.tpm}/${t.tpa} 3PT, ${t.ftm}/${t.fta} FT, ${t.reb} REB, ${t.ast} AST, ${t.stl} STL, ${t.tov} TOV, ${t.pf} fouls`);
  const score = scoreboard
    ? `Final score (read off the in-video scoreboard): ${scoreboard.teams.map(t => `${teamLabel(teams, t.color)} ${t.final}`).join(" – ")}.`
    : "No scoreboard was readable, so the final score is unknown — do not state one.";
  return `\nGAME FACTS (counted in code — use these exact teams, score and numbers; never contradict them):
Teams: ${teams.colors.map(c => teamLabel(teams, c)).join(" vs ")}
${score}
${lines.join("\n")}\n`;
}

// Fill in every code-computed part of a game report, overriding the parts
// the model used to guess (team names, score, winner, stat bars).
export function finalizeGameReport(report: GameReport, g: PreparedGame): GameReport {
  const { teams, scoreboard } = g;
  report.boxScore = buildBoxScore(g.texts);
  report.volleyBox = buildVolleyBoxScore(g.texts);
  report.timeline = buildDecisionTimeline(g.texts);
  report.teams = teams.colors.map(color => ({ color, name: teams.names[color] ?? null }));
  report.scoreboard = scoreboard;
  if (report.boxScore.length > 0 && teams.colors.length === 2) {
    report.teamTotals = buildTeamTotals(report.boxScore, teams.colors);
    const [a, b] = report.teamTotals;
    const fa = scoreboard?.teams[0].final, fb = scoreboard?.teams[1].final;
    const winner = fa != null && fb != null && fa !== fb ? teamLabel(teams, fa > fb ? a.color : b.color) : null;
    report.teamComparison = {
      teamA: teamLabel(teams, a.color), teamB: teamLabel(teams, b.color),
      score: fa != null && fb != null ? `${fa}–${fb}` : null,
      winner,
      stats: [
        { label: "Field goals made", a: a.fgm, b: b.fgm },
        { label: "3-pointers made", a: a.tpm, b: b.tpm },
        { label: "Free throws made", a: a.ftm, b: b.ftm },
        { label: "Rebounds", a: a.reb, b: b.reb },
        { label: "Assists", a: a.ast, b: b.ast },
        { label: "Steals", a: a.stl, b: b.stl },
        { label: "Turnovers", a: a.tov, b: b.tov },
        { label: "Fouls", a: a.pf, b: b.pf },
      ],
      why: report.teamComparison?.why ?? "",
    };
  }
  return report;
}

// ─── Report view model (client-safe) ─────────────────────────────────────────

export type RosterPlayer = {
  key: string; color: string; jersey: string | null; label: string;
  good: number; neutral: number; poor: number;
  box: PlayerBoxStat | null; standout: string | null;
};
export type RosterTeam = { color: string; name: string | null; players: RosterPlayer[]; totals: TeamTotals | null; final: number | null; scoredOnFilm: number | null };

// Build the two team columns from counted data — the box score and the
// decision timeline — never from the model's prose. The old view pulled team
// names out of "(...)" in a model-written sentence, which is how a timestamp
// ("25:33") and "Uploader" ended up as team names.
export function buildRosterView(report: GameReport): RosterTeam[] {
  const box = report.boxScore ?? [];
  const timeline = report.timeline ?? [];

  let teams = report.teams ?? [];
  if (teams.length < 2) {
    // Older reviews: take the two most common colours, and names from the
    // "Name (Colour)" team comparison labels when present.
    const counts = new Map<string, number>();
    for (const p of [...box.map(b => b.player), ...timeline.map(t => t.player)]) {
      const { team } = parsePlayerLabel(p);
      if (team !== "unknown") counts.set(team, (counts.get(team) ?? 0) + 1);
    }
    const tc = report.teamComparison;
    const nameFor = (color: string) => {
      for (const label of [tc?.teamA, tc?.teamB]) {
        const m = label?.match(/^(.*?)\s*\(([^)]+)\)/);
        if (m && teamKeysFromColor(m[2]).includes(color)) return m[1].trim();
      }
      return null;
    };
    teams = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([color]) => ({ color, name: nameFor(color) }));
  }
  const colors = teams.map(t => t.color);

  const players = new Map<string, RosterPlayer>();
  const get = (label: string) => {
    const { team, jersey } = parsePlayerLabel(label);
    if (!colors.includes(team) || !jersey) return null; // descriptive/unknown labels can't be merged reliably
    const key = `${team}#${jersey}`;
    if (!players.has(key)) players.set(key, { key, color: team, jersey, label: `${cap(team)} #${jersey}`, good: 0, neutral: 0, poor: 0, box: null, standout: null });
    return players.get(key)!;
  };
  for (const r of box) { const p = get(r.player); if (p) p.box = r; }
  for (const t of timeline) { const p = get(t.player); if (p) p[t.quality]++; }
  for (const s of report.playerStats ?? []) {
    const p = get(s.label);
    const standout = s.raw.match(/Standout[^:]*:\s*(.+?)\s*$/i)?.[1]?.trim();
    if (p && standout && !p.standout) p.standout = standout;
  }

  const totals = report.teamTotals ?? (box.length ? buildTeamTotals(box, colors) : []);
  return teams.map((t, i) => {
    const sb = report.scoreboard?.teams.find(s => s.color === t.color) ?? null;
    return {
      color: t.color, name: t.name,
      totals: totals.find(x => x.color === t.color) ?? null,
      final: sb?.final ?? null,
      scoredOnFilm: sb ? sb.final - sb.start : null,
      players: [...players.values()].filter(p => p.color === colors[i])
        .sort((a, b) => ((b.box?.pts ?? 0) - (a.box?.pts ?? 0)) || ((b.good + b.neutral + b.poor) - (a.good + a.neutral + a.poor))),
    };
  });
}
