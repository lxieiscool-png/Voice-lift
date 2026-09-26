import type { PlayerBoxStat, PlayerVolleyStat, Review, TeamMember } from "../types";
import { parsePlayerLabel, teamKeysFromColor } from "./parsers";
import { playedAt } from "../decisioniq-helpers";

// Season ledger: per-player totals, averages and game logs, summed in code
// from each game's box score. Every number here is only as good as the per-game
// AI box scores it's built from — the UI labels it an estimate.
//
// Identity across games is the jersey number on the user's side of each game.
// Which side was theirs comes from the jersey colour saved with the review
// (colours change home/away, so we can't key on colour across games).

export type StatSport = "basketball" | "volleyball";

export type DecisionCounts = { good: number; neutral: number; poor: number };

export type GameLine = {
  reviewId: string;
  date: number;
  opponent: string | null;
  basketball?: PlayerBoxStat;
  volleyball?: PlayerVolleyStat;
  decisions: DecisionCounts;
};

export type SeasonPlayer = {
  jersey: string;
  name: string | null;       // from the roster, when the number is on it
  onRoster: boolean;
  gp: number;                // games with at least one logged stat or decision
  basketball: Omit<PlayerBoxStat, "player" | "team" | "jersey">;
  volleyball: Omit<PlayerVolleyStat, "player" | "team" | "jersey">;
  decisions: DecisionCounts;
  games: GameLine[];         // oldest first
};

// One counted game from the team's side: the result and how much of the
// scoring the box score caught. Score comes from the in-video scoreboard when
// it was readable, otherwise from summing the box score (an undercount).
export type GameResultLine = {
  review: Review;
  date: number;
  opponent: string | null;
  us: number | null;
  them: number | null;
  fromScoreboard: boolean;
  outcome: "W" | "L" | "T" | null;   // only with a scoreboard score
  tracked: number;                    // points our box score logged
  onFilm: number | null;              // points we scored on film, per the scoreboard
};

export type SeasonLedger = {
  sport: StatSport;
  gamesCounted: Review[];
  // Games with a box score but no saved jersey colour — we can't tell which
  // side was the user's, so they're left out until the colour is set.
  needsColor: { review: Review; colors: string[] }[];
  // Older analyses of a film that was re-analyzed — only the newest counts,
  // so re-running a game doesn't double its stats.
  superseded: Review[];
  players: SeasonPlayer[];
  results: GameResultLine[];          // newest first
  team: {
    gp: number; ptsFor: number; ptsAgainst: number; gamesWithOpp: number;
    wins: number; losses: number; ties: number;
    // Scoreboard-backed coverage across the season: points the box scores
    // caught vs points actually scored on film.
    tracked: number; onFilm: number;
  };
};

const zeroBox = () => ({ pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, tov: 0, blk: 0, pf: 0 });
const zeroVolley = () => ({ k: 0, e: 0, ta: 0, sa: 0, se: 0, ast: 0, d: 0, bs: 0, re: 0, faults: 0 });


function addInto<T extends Record<string, unknown>>(target: Record<string, number>, row: T) {
  for (const k of Object.keys(target)) target[k] += Number(row[k] ?? 0);
}

// Which box-score team keys appear in a game (e.g. ["blue", "white"]).
export function gameColors(r: Review): string[] {
  const rows = [...(r.gameReport?.boxScore ?? []), ...(r.gameReport?.volleyBox ?? [])];
  return [...new Set(rows.map(x => x.team).filter(t => t && t !== "unknown"))];
}

// The box-score team key that was the user's side, or null if unknown.
// The saved jersey colour wins; newer analyses also resolve the uploader's
// team themselves (gameReport.teams[0]), which covers games without one.
export function ourKey(r: Review): string | null {
  const colors = gameColors(r);
  const typed = teamKeysFromColor(r.teamColor).find(k => colors.includes(k));
  if (typed) return typed;
  // A real colour that isn't in this game's box score: don't guess.
  if (teamKeysFromColor(r.teamColor).length > 0) return null;
  const resolved = r.gameReport?.teams?.[0]?.color;
  return resolved && colors.includes(resolved) ? resolved : null;
}

export function buildSeasonLedger(games: Review[], roster: TeamMember[] = [], sportHint?: string): SeasonLedger {
  const allWithStats = games.filter(r =>
    r.mode === "game" && ((r.gameReport?.boxScore?.length ?? 0) + (r.gameReport?.volleyBox?.length ?? 0)) > 0
  );
  // Same film (file name / YouTube URL) on the same team = a re-analysis.
  // Keep the most recent run; its date and colour are the latest the user set.
  const newestByFilm = new Map<string, Review>();
  for (const r of allWithStats) {
    const film = `${r.teamId ?? ""}|${r.fileName.trim().toLowerCase()}`;
    const prev = newestByFilm.get(film);
    if (!prev || r.timestamp > prev.timestamp) newestByFilm.set(film, r);
  }
  const kept = new Set(newestByFilm.values());
  const superseded = allWithStats.filter(r => !kept.has(r));
  const withStats = [...kept].sort((a, b) => playedAt(a) - playedAt(b));

  const volleyGames = withStats.filter(r => (r.gameReport?.volleyBox?.length ?? 0) > 0).length;
  const sport: StatSport = /volley/i.test(sportHint || "") || volleyGames > withStats.length / 2 ? "volleyball" : "basketball";

  const nameByJersey = new Map<string, string | null>();
  for (const m of roster) {
    const j = m.jerseyNumber?.replace(/\D/g, "");
    if (j) nameByJersey.set(j, m.displayName || null);
  }

  const players = new Map<string, SeasonPlayer>();
  const ensure = (jersey: string) => {
    if (!players.has(jersey)) {
      players.set(jersey, {
        jersey, name: nameByJersey.get(jersey) ?? null, onRoster: nameByJersey.has(jersey),
        gp: 0, basketball: zeroBox(), volleyball: zeroVolley(),
        decisions: { good: 0, neutral: 0, poor: 0 }, games: [],
      });
    }
    return players.get(jersey)!;
  };

  const counted: Review[] = [];
  const needsColor: SeasonLedger["needsColor"] = [];
  const team = { gp: 0, ptsFor: 0, ptsAgainst: 0, gamesWithOpp: 0, wins: 0, losses: 0, ties: 0, tracked: 0, onFilm: 0 };
  const results: GameResultLine[] = [];

  for (const r of withStats) {
    const key = ourKey(r);
    if (!key) { needsColor.push({ review: r, colors: gameColors(r) }); continue; }
    counted.push(r);

    const lines = new Map<string, GameLine>();
    const line = (jersey: string) => {
      if (!lines.has(jersey)) {
        lines.set(jersey, { reviewId: r.id, date: playedAt(r), opponent: r.opponentName ?? null, decisions: { good: 0, neutral: 0, poor: 0 } });
      }
      return lines.get(jersey)!;
    };

    if (sport === "basketball") {
      const box = r.gameReport?.boxScore ?? [];
      // Team points include rows with no readable jersey ("Blue Unknown");
      // only numbered rows become player lines.
      let ours = 0, theirs = 0, sawOpp = false;
      for (const row of box) {
        if (row.team === key) ours += row.pts;
        else if (row.team !== "unknown") { theirs += row.pts; sawOpp = true; }
        if (row.team !== key || !row.jersey) continue;
        line(row.jersey).basketball = row;
      }
      const sb = r.gameReport?.scoreboard?.teams;
      const sbUs = sb?.find(t => t.color === key);
      const sbThem = sb?.find(t => t.color !== key);
      const tracked = r.gameReport?.teamTotals?.find(t => t.color === key)?.pts ?? ours;
      const us = sbUs ? sbUs.final : ours;
      const them = sbThem ? sbThem.final : sawOpp ? theirs : null;
      const fromScoreboard = !!(sbUs && sbThem);
      const outcome = fromScoreboard ? (us > them! ? "W" : us < them! ? "L" : "T") : null;
      const onFilm = sbUs ? sbUs.final - sbUs.start : null;

      team.gp++;
      team.ptsFor += us;
      if (them !== null) { team.ptsAgainst += them; team.gamesWithOpp++; }
      if (outcome === "W") team.wins++; else if (outcome === "L") team.losses++; else if (outcome === "T") team.ties++;
      if (onFilm !== null && onFilm > 0) { team.tracked += Math.min(tracked, onFilm); team.onFilm += onFilm; }
      results.push({ review: r, date: playedAt(r), opponent: r.opponentName ?? null, us, them, fromScoreboard, outcome, tracked, onFilm });
    } else {
      for (const row of r.gameReport?.volleyBox ?? []) {
        if (row.team !== key || !row.jersey) continue;
        line(row.jersey).volleyball = row;
      }
      team.gp++;
      results.push({ review: r, date: playedAt(r), opponent: r.opponentName ?? null, us: null, them: null, fromScoreboard: false, outcome: null, tracked: 0, onFilm: null });
    }

    // Decision quality — Reel's own stat. Every logged possession counts
    // toward the player's good/poor split for the season.
    for (const ev of r.gameReport?.timeline ?? []) {
      const { team: t, jersey } = parsePlayerLabel(ev.player);
      if (t !== key || !jersey) continue;
      line(jersey).decisions[ev.quality]++;
    }

    for (const [jersey, gl] of lines) {
      const p = ensure(jersey);
      p.gp++;
      if (gl.basketball) addInto(p.basketball, gl.basketball);
      if (gl.volleyball) addInto(p.volleyball, gl.volleyball);
      p.decisions.good += gl.decisions.good;
      p.decisions.neutral += gl.decisions.neutral;
      p.decisions.poor += gl.decisions.poor;
      p.games.push(gl);
    }
  }

  const primary = (p: SeasonPlayer) => sport === "basketball" ? p.basketball.pts : p.volleyball.k;
  const sorted = [...players.values()].sort((a, b) =>
    Number(b.onRoster) - Number(a.onRoster) || primary(b) / b.gp - primary(a) / a.gp || b.gp - a.gp
  );

  results.reverse();
  return { sport, gamesCounted: counted, needsColor, superseded, players: sorted, results, team };
}

export function perGame(total: number, gp: number): string {
  return gp > 0 ? (total / gp).toFixed(1) : "—";
}

export function pct(made: number, att: number): string {
  return att > 0 ? `${Math.round((made / att) * 100)}%` : "—";
}

// Share of logged decisions graded good, ignoring neutral ones.
export function goodDecisionPct(d: DecisionCounts): string {
  const graded = d.good + d.poor;
  return graded > 0 ? `${Math.round((d.good / graded) * 100)}%` : "—";
}

export function hittingPct(k: number, e: number, ta: number): string {
  return ta > 0 ? ((k - e) / ta).toFixed(3).replace(/^(-?)0\./, "$1.") : "—";
}
