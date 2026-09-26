"use client";

import { Fragment, useState } from "react";
import { ChevronDown } from "lucide-react";
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

function EstimateBadge() {
  return <span className="rounded-full border border-amber-900/60 bg-amber-950/30 px-2 py-0.5 text-[10px] font-semibold text-amber-400">AI estimate</span>;
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
                  className="rounded-lg border border-border px-2.5 py-1 font-semibold text-muted-foreground hover:border-ring hover:text-foreground disabled:opacity-50">
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
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Results</h3>
        {onFilm > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Box scores caught <span className="font-semibold text-foreground">{Math.round((tracked / onFilm) * 100)}%</span> of points scored on film
          </p>
        )}
      </div>
      <div className="divide-y divide-border border-y border-border">
        {ledger.results.map(g => (
          <div key={g.review.id} className="flex items-center gap-3 px-1 py-2 text-xs">
            <span className="w-14 shrink-0 font-mono text-[11px] text-muted-foreground">{shortDate(g.date)}</span>
            <span className="min-w-0 flex-1 truncate text-foreground">{g.opponent ? `vs ${g.opponent}` : g.review.fileName}</span>
            {g.outcome && (
              <span className={`w-5 text-center font-bold ${g.outcome === "W" ? "text-emerald-400" : g.outcome === "L" ? "text-red-400" : "text-muted-foreground"}`}>{g.outcome}</span>
            )}
            <span className="w-16 text-right font-mono text-foreground" title={g.fromScoreboard ? "Final from the scoreboard" : "Summed from the box score — likely low"}>
              {g.us ?? "—"}–{g.them ?? "—"}{!g.fromScoreboard && <span className="text-muted-foreground">*</span>}
            </span>
            <span className="hidden w-28 text-right text-[11px] text-muted-foreground sm:block">
              {g.onFilm ? `tracked ${Math.min(g.tracked, g.onFilm)} of ${g.onFilm}` : "no scoreboard"}
            </span>
          </div>
        ))}
      </div>
      {ledger.results.some(g => !g.fromScoreboard) && (
        <p className="mt-1.5 text-[10px] text-muted-foreground">* No readable scoreboard; score summed from the box score, so it&apos;s likely low.</p>
      )}
    </div>
  );
}

type Col = { label: string; title: string; get: (p: SeasonPlayer, avg: boolean) => string };

function columns(sport: SeasonLedger["sport"]): Col[] {
  const v = (n: number, p: SeasonPlayer, avg: boolean) => avg ? perGame(n, p.gp) : String(n);
  if (sport === "volleyball") return [
    { label: "K",    title: "Kills",           get: (p, a) => v(p.volleyball.k, p, a) },
    { label: "HIT%", title: "Hitting %",       get: p => hittingPct(p.volleyball.k, p.volleyball.e, p.volleyball.ta) },
    { label: "AST",  title: "Set assists",     get: (p, a) => v(p.volleyball.ast, p, a) },
    { label: "DIG",  title: "Digs",            get: (p, a) => v(p.volleyball.d, p, a) },
    { label: "SA",   title: "Service aces",    get: (p, a) => v(p.volleyball.sa, p, a) },
    { label: "SE",   title: "Service errors",  get: (p, a) => v(p.volleyball.se, p, a) },
    { label: "BLK",  title: "Stuff blocks",    get: (p, a) => v(p.volleyball.bs, p, a) },
  ];
  return [
    { label: "PTS", title: "Points",     get: (p, a) => v(p.basketball.pts, p, a) },
    { label: "REB", title: "Rebounds",   get: (p, a) => v(p.basketball.reb, p, a) },
    { label: "AST", title: "Assists",    get: (p, a) => v(p.basketball.ast, p, a) },
    { label: "STL", title: "Steals",     get: (p, a) => v(p.basketball.stl, p, a) },
    { label: "BLK", title: "Blocks",     get: (p, a) => v(p.basketball.blk, p, a) },
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

function GameLog({ sport, player, cols }: { sport: SeasonLedger["sport"]; player: SeasonPlayer; cols: Col[] }) {
  const games = [...player.games].reverse();
  const headline = player.games.map(g => sport === "volleyball" ? (g.volleyball?.k ?? 0) : (g.basketball?.pts ?? 0));
  return (
    <div className="bg-muted/40 px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Game log</p>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{sport === "volleyball" ? "Kills" : "Points"} by game</span>
          <Sparkline values={headline} />
        </div>
      </div>
      <table className="w-full text-right text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="py-1 pr-2 text-left font-semibold">Game</th>
            {cols.map(c => <th key={c.label} className="px-1.5 py-1 font-semibold">{c.label.replace("%", "")}</th>)}
            <th className="px-1.5 py-1 font-semibold">DEC</th>
          </tr>
        </thead>
        <tbody>
          {games.map(g => (
            <tr key={g.reviewId} className="border-t border-border">
              <td className="py-1.5 pr-2 text-left text-foreground">
                <span className="font-mono text-[11px] text-muted-foreground">{shortDate(g.date)}</span>
                {g.opponent && <span className="ml-2">vs {g.opponent}</span>}
              </td>
              {gameLineCells(sport, g).map((c, i) => <td key={i} className="px-1.5 py-1.5 text-foreground">{c}</td>)}
              <td className="px-1.5 py-1.5 text-muted-foreground">{g.decisions.good}–{g.decisions.poor}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-muted-foreground">
        {sport === "basketball" && "Shooting shown as made–attempted. "}DEC = good–poor decisions logged.
      </p>
    </div>
  );
}

function PlayerRows({ ledger, rows, cols, avg, open, onToggle, highlightJersey }: {
  ledger: SeasonLedger; rows: SeasonPlayer[]; cols: Col[]; avg: boolean;
  open: string | null; onToggle: (j: string) => void; highlightJersey?: string;
}) {
  return (
    <>
      {rows.map(p => {
        const isOpen = open === p.jersey;
        const mine = highlightJersey && p.jersey === highlightJersey;
        return (
          <Fragment key={p.jersey}>
            <tr onClick={() => onToggle(p.jersey)}
              className={`cursor-pointer border-t border-border hover:bg-muted/50 ${mine ? "bg-muted/60" : ""}`}>
              <td className="py-2 pr-2 text-left">
                <div className="flex items-center gap-2">
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                  <span className="w-7 font-mono text-muted-foreground">#{p.jersey}</span>
                  <span className="truncate font-semibold text-foreground">{p.name || (mine ? "You" : "—")}</span>
                </div>
              </td>
              <td className="px-1.5 py-2 text-muted-foreground">{p.gp}</td>
              {cols.map((c, i) => <td key={c.label} className={`px-1.5 py-2 ${i === 0 ? "font-bold text-foreground" : "text-foreground"}`}>{c.get(p, avg)}</td>)}
              <td className="px-1.5 py-2 text-foreground">{goodDecisionPct(p.decisions)}</td>
            </tr>
            {isOpen && (
              <tr><td colSpan={cols.length + 3} className="p-0"><GameLog sport={ledger.sport} player={p} cols={cols} /></td></tr>
            )}
          </Fragment>
        );
      })}
    </>
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
    <section>
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-sm font-bold text-foreground">Season stats</h2>
          <EstimateBadge />
        </div>
        {ledger.players.length > 0 && (
          <Segmented value={avg ? "avg" : "tot"} onChange={v => setAvg(v === "avg")}
            options={[{ value: "avg", label: "Per game" }, { value: "tot", label: "Totals" }]} />
        )}
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        Summed from each game&apos;s AI box score across {ledger.gamesCounted.length} {ledger.gamesCounted.length === 1 ? "game" : "games"}. GP counts games where a player had something logged. DEC% is the share of their graded decisions that were good.
      </p>

      <ResultsList ledger={ledger} />

      {ledger.players.length === 0 ? (ledger.needsColor.length > 0 ? null :
        <p className="py-4 text-sm text-muted-foreground">
          {games.some(g => g.mode === "game")
            ? "No player stats yet. Stats come from full games analyzed with \"Team game footage\" — clips don't produce a box score."
            : "Link full games to this team and season stats will build up here, game by game."}
        </p>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[640px] text-right text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-2 text-left font-semibold">Player</th>
                <th className="px-1.5 py-1 font-semibold" title="Games played">GP</th>
                {cols.map(c => <th key={c.label} className="px-1.5 py-1 font-semibold" title={c.title}>{c.label}</th>)}
                <th className="px-1.5 py-1 font-semibold" title="Good decisions %">DEC%</th>
              </tr>
            </thead>
            <tbody>
              <PlayerRows ledger={ledger} rows={rostered} cols={cols} avg={avg} open={open} onToggle={toggle} highlightJersey={highlightJersey} />
              {offRoster.length > 0 && (
                <>
                  <tr>
                    <td colSpan={cols.length + 3} className="pb-1 pt-4 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Not on your roster — often a misread jersey number
                    </td>
                  </tr>
                  <PlayerRows ledger={ledger} rows={offRoster} cols={cols} avg={avg} open={open} onToggle={toggle} highlightJersey={highlightJersey} />
                </>
              )}
            </tbody>
          </table>
        </div>
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
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-display text-sm font-bold text-foreground">Your season{j ? ` · #${j}` : ""}</h2>
        <EstimateBadge />
      </div>
      {!j ? (
        <p className="text-xs text-muted-foreground">Add your jersey number to your profile and we&apos;ll track your season stats across every game you analyze.</p>
      ) : !me ? (ledger.needsColor.length > 0 ? null :
        <p className="text-xs text-muted-foreground">
          No stats logged for #{j} yet{ledger.gamesCounted.length > 0 ? ` across ${ledger.gamesCounted.length} counted ${ledger.gamesCounted.length === 1 ? "game" : "games"}` : ""}. Stats come from full games where you set your jersey colour.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-6">
            {tiles.map(t => (
              <div key={t.label}>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t.label}</p>
                <p className="font-display text-xl font-bold text-foreground">{t.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 overflow-x-auto rounded-lg border border-border"><div className="min-w-[560px]"><GameLog sport={ledger.sport} player={me} cols={cols} /></div></div>
        </>
      )}
      <NeedsColor items={ledger.needsColor} onSetColor={onSetColor} />
      <SupersededNote items={ledger.superseded} />
    </section>
  );
}
