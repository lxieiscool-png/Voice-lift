// Scoreboard-anchored scoring. Two narrow Gemini tasks instead of one broad
// one:
//   1. A scoreboard-only pass reads every score change (when, how much, which
//      side). On a real game this got both team totals exactly right, which
//      the "watch everything" windows never did.
//   2. For each change, a short high-frame-rate clip ends where the board
//      changed and asks one question: who scored? Jerseys are far more legible
//      at 5 fps over ~16 s than at 1 fps over two minutes.
// The scoreboard decides THAT points happened and how many; the clip decides
// WHO. If the board isn't readable the caller falls back to the windows.

import { teamKeysFromColor } from "./parsers";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;
const parseT = (m: string) => m.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);

export const SCOREBOARD_WINDOW = 240;

export function scoreboardPrompt(start: number, end: number): string {
  return `You are reading ONLY the scoreboard or on-screen score overlay in this basketball video. This footage is ${fmt(start)}–${fmt(end)} of the full video; the clip you see starts at 0:00, so add ${fmt(start)} to every time you observe.
List every moment the displayed score changes. One line per change, exactly:
M:SS | TEAM_A <score> - TEAM_B <score>
using the team names or abbreviations exactly as shown on the scoreboard, and M:SS the ABSOLUTE video time of the change. First line: "START | TEAM_A <score> - TEAM_B <score>" as shown at the start of this footage.
Read the digits directly. Never work the score out from the plays. If no score is legible anywhere in this footage, write NONE.`;
}

type Reading = { t: number; a: string; x: number; b: string; y: number };

export function parseScoreboard(text: string, windowStart: number): Reading[] {
  const out: Reading[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(START|\d{1,2}:\d{2}(?::\d{2})?)\s*\|\s*([A-Za-z][\w .'&-]*?)\s+(\d{1,3})\s*[-–]\s*([A-Za-z][\w .'&-]*?)\s+(\d{1,3})\s*$/i);
    if (!m) continue;
    out.push({ t: m[1].toUpperCase() === "START" ? windowStart : parseT(m[1]), a: m[2].trim(), x: +m[3], b: m[4].trim(), y: +m[5] });
  }
  return out;
}

export type ScoreEvent = { t: number; side: 0 | 1; pts: number };
export type Timeline = { events: ScoreEvent[]; start: [number, number]; final: [number, number]; readings: number };

const first = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Map scoreboard labels to our two sides. `aliases` holds every label known
// to mean side 0 or 1 (team names the uploader typed, names the windows saw
// next to a jersey colour on the board); anything else is matched by prefix.
function sideOf(label: string, aliases: [string[], string[]]): 0 | 1 | null {
  const l = first(label);
  for (const side of [0, 1] as const)
    for (const a of aliases[side]) { const k = first(a); if (k && (k.startsWith(l) || l.startsWith(k) || k.slice(0, 3) === l.slice(0, 3))) return side; }
  return null;
}

// The longest physically possible chain of readings: scores never go down,
// and can't climb faster than a team can score. Misreads (and invented
// digits) fall out because they break the chain.
export function buildTimeline(readings: Reading[], aliases: [string[], string[]]): Timeline | null {
  const seq: { t: number; v: [number, number] }[] = [];
  for (const r of readings.sort((p, q) => p.t - q.t)) {
    const sa = sideOf(r.a, aliases), sb = sideOf(r.b, aliases);
    let v: [number, number] | null = null;
    if (sa === 0 || sb === 1) v = [r.x, r.y];
    else if (sa === 1 || sb === 0) v = [r.y, r.x];
    if (v) seq.push({ t: r.t, v });
  }
  if (seq.length < 3) return null;
  const ok = (a: typeof seq[0], b: typeof seq[0]) =>
    b.t >= a.t && b.v[0] >= a.v[0] && b.v[1] >= a.v[1] && (b.v[0] - a.v[0]) + (b.v[1] - a.v[1]) <= Math.max(4, (b.t - a.t) / 8);
  const len = seq.map(() => 1), prev = seq.map(() => -1);
  for (let j = 0; j < seq.length; j++) for (let i = 0; i < j; i++)
    if (ok(seq[i], seq[j]) && len[i] + 1 > len[j]) { len[j] = len[i] + 1; prev[j] = i; }
  let end = 0; len.forEach((l, i) => { if (l > len[end]) end = i; });
  if (len[end] < 3) return null;
  const chain: typeof seq = [];
  for (let k = end; k !== -1; k = prev[k]) chain.unshift(seq[k]);
  const events: ScoreEvent[] = [];
  for (let i = 1; i < chain.length; i++)
    for (const side of [0, 1] as const) {
      const d = chain[i].v[side] - chain[i - 1].v[side];
      if (d > 0) events.push({ t: chain[i].t, side, pts: d });
    }
  return { events, start: chain[0].v, final: chain[chain.length - 1].v, readings: seq.length };
}

export const CLIP_BEFORE = 14, CLIP_AFTER = 2;

export function attributionPrompt(ev: ScoreEvent, teamLabel: string, colourWord: string, roster: string[]): string {
  return `Basketball clip, about ${CLIP_BEFORE + CLIP_AFTER} seconds. At the very end of this clip the scoreboard shows ${teamLabel} scoring ${ev.pts} point${ev.pts > 1 ? "s" : ""}. Watch the clip and identify who scored those points for ${teamLabel}.
${roster.length ? `${teamLabel} roster numbers: ${roster.join(", ")}. The scorer is one of these.\n` : ""}Read the scorer's jersey number carefully across several frames. Answer with exactly one line:
SCORER: ${colourWord} #<number> | TYPE: <made_2 | made_3 | made_ft> | ASSIST: <${colourWord} #<number> or none> | CONFIDENCE: <high | medium | low>
If you truly cannot read the number, answer "SCORER: ${colourWord} Unknown" with the other fields.`;
}

// Stat-event lines for one scoring event. The scoreboard's point total is
// trusted over the model's shot type when they disagree.
export function attributionLines(text: string, ev: ScoreEvent, colourWord: string): string[] {
  const m = text.match(/SCORER:\s*([A-Za-z]+\s*(?:#\s*\d{1,2}|Unknown))(?:[^|\n]*)\|\s*TYPE:\s*(made_2|made_3|made_ft)(?:[^|\n]*\|\s*ASSIST:\s*([A-Za-z]+\s*#\s*\d{1,2}|none))?/i);
  const who = m ? m[1].replace(/\s+/g, " ").replace(/^\w/, c => c.toUpperCase()) : `${colourWord} Unknown`;
  let type = (m?.[2]?.toLowerCase() as "made_2" | "made_3" | "made_ft") ?? null;
  const val = (t: string) => (t === "made_3" ? 3 : t === "made_ft" ? 1 : 2);
  if (!type || ev.pts % val(type) !== 0) type = ev.pts === 3 ? "made_3" : ev.pts === 1 ? "made_ft" : ev.pts % 2 === 0 ? "made_2" : "made_ft";
  const lines = Array.from({ length: Math.max(1, ev.pts / val(type)) }, () => `- ${who} | ${type}`);
  const assist = m?.[3];
  if (assist && !/none/i.test(assist) && type !== "made_ft") lines.push(`- ${assist.replace(/\s+/g, " ")} | assist`);
  return lines;
}

// Window texts minus their own made-basket lines, so points come only from
// the anchored events (misses, rebounds, steals etc. stay).
export function stripMadeLines(text: string): string {
  return text.split("\n").filter(l => !/\|\s*made_(2|3|ft)\s*$/i.test(l)).join("\n");
}

// Every name known to mean each side, for matching scoreboard labels.
export function sideAliases(chunkTexts: string[], ourColour: string, theirColour: string, ourName?: string | null, theirName?: string | null): [string[], string[]] {
  const out: [string[], string[]] = [[ourName ?? "", ourColour], [theirName ?? "", theirColour]];
  for (const t of chunkTexts) for (const label of ["Score Start", "Score End"]) {
    const line = t.match(new RegExp(`^${label}:\\s*(.+)$`, "im"))?.[1] ?? "";
    const m = line.match(/^(.+?)\s+\d{1,3}\s*[-–:]\s*(.+?)\s+\d{1,3}\s*\[\s*(.+?)\s*[-–]\s*(.+?)\s*\]/);
    if (!m) continue;
    for (const [side, name] of [[m[1], m[3]], [m[2], m[4]]] as const) {
      const c = teamKeysFromColor(side)[0];
      if (c === ourColour) out[0].push(name); else if (c === theirColour) out[1].push(name);
    }
  }
  return [out[0].filter(Boolean), out[1].filter(Boolean)];
}
