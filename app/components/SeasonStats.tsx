"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { StatTable, StatHeader, CoverageMeter, type StatCol } from "./ui/stat-table";
import type { Review, TeamMember } from "../lib/types";
import { Segmented } from "./ui/segmented";
import { createClient } from "../lib/supabase/client";
import {
  buildSeasonLedger, goodDecisionPct, hittingPct, perGame, pct,
  type GameLine, type SeasonLedger, type SeasonPlayer,
} from "../lib/analysis/seasonStats";

// Save the jersey colour for a game that was analyzed before we stored it.
// The colour lives in the review's data JSONB alongside the report.
export async function saveReviewTeamColor(userId: string | undefined, review: Review, color: string): Promise<boolean> {
  if (!userId) return false;
  const supabase = createClient();
  const { error } = await supabase.from("reviews")
    .update({ data: { decisions: review.decisions, gameReport: review.gameReport, teamColor: color } })
    .eq("id", review.id).eq("user_id", userId);
  if (error) { console.error("Failed to save jersey colour:", error.message); return false; }
  return true;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const shortDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

// Honest but quiet: these are counted from film, not an official scorebook.
function EstimateNote() {
  return <span title="Counted by AI from your film, not an official scorebook">Estimated from film</span>;
}

// Games we can't count yet because we don't know which colour was the user's.
function NeedsColor({ items, onSetColor }: { items: SeasonLedger["needsColor"]; onSetColor?: (r: Review, color: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="text-xs text-muted-foreground">
        {items.length} {items.length === 1 ? "game isn't" : "games aren't"} counted yet — pick the colour you wore so we know which side was yours.
      </p>
      <div className="mt-2 space-y-1.5">
        {items.map(({ review, colors }) => (
          <div key={review.id} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-foreground">{review.opponentName ? `vs ${review.opponentName}` : review.fileName}</span>
            {colors.length === 0
              ? <span className="text-muted-foreground">No team colours in this box score</span>
              : colors.map(c => (
                <button key={c} disabled={!onSetColor} onClick={() => onSetColor?.(review, c)}
                  className="btn-pill btn-light !px-3 !py-1.5 !text-xs">
                  {cap(c)}
                </button>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SupersededNote({ items }: { items: Review[] }) {
  if (items.length === 0) return null;
  return (
    <p className="mt-3 text-[11px] text-muted-foreground">
      {items.length} older {items.length === 1 ? "analysis" : "analyses"} of a re-analyzed film left out, so nothing counts twice. Only the newest run of each film is used.
    </p>
  );
}

// Game-by-game results for the team, with how much of the scoring the box
// score caught when the scoreboard gave us the real number.
function ResultsList({ ledger }: { ledger: SeasonLedger }) {
  if (ledger.sport !== "basketball" || ledger.results.length === 0) return null;
  const { tracked, onFilm } = ledger.team;
  return (
    <div className="mb-8">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">Results</p>
        {onFilm > 0 && <CoverageMeter tracked={tracked} total={onFilm} label="points this season" />}
      </div>
      <div className="divide-y divide-border border-y border-border">
        {ledger.results.map(g => (
          <div key={g.review.id} className="flex items-center gap-3 py-3 text-[14px]">
            {g.outcome ? (
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-medium ${g.outcome === "W" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : g.outcome === "L" ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-muted text-muted-foreground"}`}>{g.outcome}</span>
            ) : <span className="h-7 w-7 shrink-0" />}
            <span className="min-w-0 flex-1 truncate text-foreground">{g.opponent ? `vs ${g.opponent}` : g.review.fileName}</span>
            <span className="hidden text-[12px] text-muted-foreground sm:block">
              {g.onFilm ? `${Math.min(g.tracked, g.onFilm)} of ${g.onFilm} pts tracked` : "No scoreboard"}
            </span>
            <span className="w-16 text-right tabular-nums text-foreground" title={g.fromScoreboard ? "Final from the scoreboard" : "Summed from the box score — likely low"}>
              {g.us ?? "—"}–{g.them ?? "—"}{!g.fromScoreboard && <span className="text-muted-foreground">*</span>}
            </span>
            <span className="w-12 shrink-0 text-right text-[12px] text-muted-foreground">{shortDate(g.date)}</span>
          </div>
        ))}
      </div>
      {ledger.results.some(g => !g.fromScoreboard) && (
        <p className="mt-2 text-[12px] text-muted-foreground">* No readable scoreboard, so the score is summed from the box score and likely low.</p>
      )}
    </div>
  );
}

type Col = { label: string; title: string; get: (p: SeasonPlayer, avg: boolean) => string; lead?: (p: SeasonPlayer) => number };

function columns(sport: SeasonLedger["sport"]): Col[] {
  const v = (n: number, p: SeasonPlayer, avg: boolean) => avg ? perGame(n, p.gp) : String(n);
  if (sport === "volleyball") return [
    { label: "K",    title: "Kills",           get: (p, a) => v(p.volleyball.k, p, a) , lead: p => p.volleyball.k / Math.max(1, p.gp) },
    { label: "HIT%", title: "Hitting %",       get: p => hittingPct(p.volleyball.k, p.volleyball.e, p.volleyball.ta) },
    { label: "AST",  title: "Set assists",     get: (p, a) => v(p.volleyball.ast, p, a) , lead: p => p.volleyball.ast / Math.max(1, p.gp) },
    { label: "DIG",  title: "Digs",            get: (p, a) => v(p.volleyball.d, p, a) , lead: p => p.volleyball.d / Math.max(1, p.gp) },
    { label: "SA",   title: "Service aces",    get: (p, a) => v(p.volleyball.sa, p, a) , lead: p => p.volleyball.sa / Math.max(1, p.gp) },
    { label: "SE",   title: "Service errors",  get: (p, a) => v(p.volleyball.se, p, a) },
    { label: "BLK",  title: "Stuff blocks",    get: (p, a) => v(p.volleyball.bs, p, a) , lead: p => p.volleyball.bs / Math.max(1, p.gp) },
  ];
  return [
    { label: "PTS", title: "Points",     get: (p, a) => v(p.basketball.pts, p, a) , lead: p => p.basketball.pts / Math.max(1, p.gp) },
    { label: "REB", title: "Rebounds",   get: (p, a) => v(p.basketball.reb, p, a) , lead: p => p.basketball.reb / Math.max(1, p.gp) },
    { label: "AST", title: "Assists",    get: (p, a) => v(p.basketball.ast, p, a) , lead: p => p.basketball.ast / Math.max(1, p.gp) },
    { label: "STL", title: "Steals",     get: (p, a) => v(p.basketball.stl, p, a) , lead: p => p.basketball.stl / Math.max(1, p.gp) },
    { label: "BLK", title: "Blocks",     get: (p, a) => v(p.basketball.blk, p, a) , lead: p => p.basketball.blk / Math.max(1, p.gp) },
    { label: "TO",  title: "Turnovers",  get: (p, a) => v(p.basketball.tov, p, a) },
    { label: "FG%", title: "Field goal %", get: p => pct(p.basketball.fgm, p.basketball.fga) },
    { label: "3P%", title: "Three-point %", get: p => pct(p.basketball.tpm, p.basketball.tpa) },
    { label: "FT%", title: "Free throw %", get: p => pct(p.basketball.ftm, p.basketball.fta) },
  ];
}

function gameLineCells(sport: SeasonLedger["sport"], g: GameLine): string[] {
  if (sport === "volleyball") {
    const s = g.volleyball;
    return s ? [s.k, hittingPct(s.k, s.e, s.ta), s.ast, s.d, s.sa, s.se, s.bs].map(String) : Array(7).fill("—");
  }
  const s = g.basketball;
  return s
    ? [s.pts, s.reb, s.ast, s.stl, s.blk, s.tov, `${s.fgm}-${s.fga}`, `${s.tpm}-${s.tpa}`, `${s.ftm}-${s.fta}`].map(String)
    : Array(9).fill("—");
}

// Small per-game trend of the headline stat (points or kills), oldest → newest.
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 96, h = 24, max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - (v / max) * (h - 4)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="text-foreground" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function GameLog({ sport, player, cols, tone = "muted" }: { sport: SeasonLedger["sport"]; player: SeasonPlayer; cols: Col[]; tone?: "card" | "muted" }) {
  const games = [...player.games].reverse();
  const headline = player.games.map(g => sport === "volleyball" ? (g.volleyball?.k ?? 0) : (g.basketball?.pts ?? 0));
  const gcols: StatCol<GameLine>[] = cols.map((c, i) => ({
    key: c.label, label: c.label.replace("%", ""), title: c.title,
    value: (g: GameLine) => gameLineCells(sport, g)[i],
  }));
  gcols.push({ key: "dec", label: "DEC", title: "Good–poor decisions", value: g => `${g.decisions.good}–${g.decisions.poor}`, muted: true });
  return (
    <div className="px-5 pb-4 pt-3 sm:px-6">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">Game log</p>
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span>{sport === "volleyball" ? "Kills" : "Points"} by game</span>
          <Sparkline values={headline} />
        </div>
      </div>
      <StatTable cols={gcols} rows={games} rowKey={g => g.reviewId} nameHeader="Game" minWidth={520} tone={tone}
        name={g => <span className="whitespace-nowrap"><span className="tabular-nums text-muted-foreground">{shortDate(g.date)}</span>{g.opponent && <span className="ml-2 text-foreground">vs {g.opponent}</span>}</span>} />
      {sport === "basketball" && <p className="mt-2 text-[12px] text-muted-foreground">Shooting as made–attempted. DEC is good–poor decisions logged.</p>}
    </div>
  );
}

function LedgerTable({ ledger, rows, cols, avg, open, onToggle, highlightJersey }: {
  ledger: SeasonLedger; rows: SeasonPlayer[]; cols: Col[]; avg: boolean;
  open: string | null; onToggle: (j: string) => void; highlightJersey?: string;
}) {
  const tcols: StatCol<SeasonPlayer>[] = [
    { key: "gp", label: "GP", title: "Games played", value: p => p.gp, muted: true },
    ...cols.map(c => ({ key: c.label, label: c.label, title: c.title, value: (p: SeasonPlayer) => c.get(p, avg), lead: c.lead })),
    { key: "dec", label: "DEC%", title: "Good decisions %", value: p => goodDecisionPct(p.decisions) },
  ];
  return (
    <StatTable cols={tcols} rows={rows} rowKey={p => p.jersey} minWidth={640}
      onRowClick={p => onToggle(p.jersey)}
      isHighlighted={p => !!highlightJersey && p.jersey === highlightJersey}
      isExpanded={p => open === p.jersey}
      renderExpanded={p => <GameLog sport={ledger.sport} player={p} cols={cols} />}
      name={p => {
        const mine = highlightJersey && p.jersey === highlightJersey;
        return (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open === p.jersey ? "" : "-rotate-90"}`} />
            <span className="w-8 font-mono text-[13px] text-foreground">#{p.jersey}</span>
            <span className="text-muted-foreground">{p.name || (mine ? "You" : "")}</span>
          </span>
        );
      }} />
  );
}

// Team season ledger: every rostered number's totals/averages across the
// team's linked games, with an expandable game log per player.
export function SeasonStatsPanel({ games, roster, sport, onSetColor, highlightJersey }: {
  games: Review[];
  roster: TeamMember[];
  sport?: string;
  onSetColor?: (r: Review, color: string) => void;
  highlightJersey?: string;
}) {
  const [avg, setAvg] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const ledger = buildSeasonLedger(games, roster, sport);
  const cols = columns(ledger.sport);
  const hasRoster = roster.some(m => m.jerseyNumber);
  const rostered = hasRoster ? ledger.players.filter(p => p.onRoster) : ledger.players;
  const offRoster = hasRoster ? ledger.players.filter(p => !p.onRoster) : [];
  const toggle = (j: string) => setOpen(open === j ? null : j);

  return (
    <section className="surface p-5 sm:p-6">
      <StatHeader title="Season stats"
        sub={<><EstimateNote /> · {ledger.gamesCounted.length} {ledger.gamesCounted.length === 1 ? "game" : "games"} counted</>}
        right={ledger.players.length > 0 && (
          <Segmented value={avg ? "avg" : "tot"} onChange={v => setAvg(v === "avg")}
            options={[{ value: "avg", label: "Per game" }, { value: "tot", label: "Totals" }]} />
        )} />

      <ResultsList ledger={ledger} />

      {ledger.players.length === 0 ? (ledger.needsColor.length > 0 ? null :
        <p className="py-4 text-sm text-muted-foreground">
          {games.some(g => g.mode === "game")
            ? "No player stats yet. Stats come from full games analyzed with \"Team game footage\" — clips don't produce a box score."
            : "Link full games to this team and season stats will build up here, game by game."}
        </p>
      ) : (
        <>
          <LedgerTable ledger={ledger} rows={rostered} cols={cols} avg={avg} open={open} onToggle={toggle} highlightJersey={highlightJersey} />
          {offRoster.length > 0 && (
            <div className="mt-6">
              <p className="mb-1 text-[13px] text-muted-foreground">Not on your roster — often a misread jersey number</p>
              <LedgerTable ledger={ledger} rows={offRoster} cols={cols} avg={avg} open={open} onToggle={toggle} highlightJersey={highlightJersey} />
            </div>
          )}
          <p className="mt-3 text-[12px] text-muted-foreground">GP counts games where a player had something logged. DEC% is the share of their graded decisions that were good.</p>
        </>
      )}

      <NeedsColor items={ledger.needsColor} onSetColor={onSetColor} />
      <SupersededNote items={ledger.superseded} />
    </section>
  );
}

// The signed-in player's own season line, across every game they've analyzed
// (any team). Needs their jersey number from the profile.
export function MySeasonCard({ reviews, jersey, onSetColor }: {
  reviews: Review[]; jersey?: string; onSetColor?: (r: Review, color: string) => void;
}) {
  const games = reviews.filter(r => r.mode === "game");
  if (games.length === 0) return null;
  const ledger = buildSeasonLedger(games);
  const j = jersey?.replace(/\D/g, "");
  const me = j ? ledger.players.find(p => p.jersey === j) : undefined;
  const cols = columns(ledger.sport);

  // Four headline columns per sport: PTS/REB/AST/FG% or K/HIT%/AST/DIG.
  const headline = ledger.sport === "volleyball" ? ["K", "HIT%", "AST", "DIG"] : ["PTS", "REB", "AST", "FG%"];
  const tiles: { label: string; value: string }[] = me ? [
    { label: "GP", value: String(me.gp) },
    ...headline.map(l => cols.find(c => c.label === l)!).map(c => ({ label: c.label.endsWith("%") ? c.label : `${c.label}/G`, value: c.get(me, true) })),
    { label: "Good decisions", value: goodDecisionPct(me.decisions) },
  ] : [];

  return (
    <section className="surface p-5 sm:p-6">
      <StatHeader title={<>Your season{j && <span className="text-quiet"> · #{j}</span>}</>} sub={<EstimateNote />} />
      {!j ? (
        <p className="text-xs text-muted-foreground">Add your jersey number to your profile and we&apos;ll track your season stats across every game you analyze.</p>
      ) : !me ? (ledger.needsColor.length > 0 ? null :
        <p className="text-xs text-muted-foreground">
          No stats logged for #{j} yet{ledger.gamesCounted.length > 0 ? ` across ${ledger.gamesCounted.length} counted ${ledger.gamesCounted.length === 1 ? "game" : "games"}` : ""}. Stats come from full games where you set your jersey colour.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-6">
            {tiles.map(t => (
              <div key={t.label}>
                <p className="font-display text-4xl tabular-nums leading-none text-foreground">{t.value}</p>
                <p className="mt-2 text-[12px] text-muted-foreground">{t.label}</p>
              </div>
            ))}
          </div>
          <div className="-mx-5 mt-6 border-t border-border sm:-mx-6"><GameLog sport={ledger.sport} player={me} cols={cols} tone="card" /></div>
        </>
      )}
      <NeedsColor items={ledger.needsColor} onSetColor={onSetColor} />
      <SupersededNote items={ledger.superseded} />
    </section>
  );
}
