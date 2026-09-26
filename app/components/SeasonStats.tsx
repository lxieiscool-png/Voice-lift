"use client";

import { Fragment, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Review, TeamMember } from "../lib/types";
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
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-sm font-bold text-foreground">Season Stats</h3>
          <EstimateBadge />
        </div>
        {ledger.players.length > 0 && (
          <div className="flex rounded-lg border border-border p-0.5 text-xs font-semibold">
            {([["Per game", true], ["Totals", false]] as const).map(([label, v]) => (
              <button key={label} onClick={() => setAvg(v)}
                className={`rounded-md px-2.5 py-1 ${avg === v ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        Summed from each game&apos;s AI box score across {ledger.gamesCounted.length} {ledger.gamesCounted.length === 1 ? "game" : "games"}. GP counts games where a player had something logged. DEC% is the share of their graded decisions that were good.
      </p>

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
    </div>
  );
}

// The signed-in player's own season line, across every game they've analyzed
// (any team). Needs their jersey number from the profile.
export function MySeasonCard({ reviews, jersey, onSetColor }: {
  reviews: Review[]; jersey?: string; onSetColor?: (r: Review, color: string) => void;
}) {
  const [showLog, setShowLog] = useState(false);
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
    <div className="mb-4 rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <p className="font-display text-sm font-bold text-foreground">Your Season</p>
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
          <button onClick={() => setShowLog(!showLog)} className="mt-3 flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showLog ? "" : "-rotate-90"}`} /> Game log
          </button>
          {showLog && <div className="mt-2 overflow-x-auto rounded-lg border border-border"><div className="min-w-[560px]"><GameLog sport={ledger.sport} player={me} cols={cols} /></div></div>}
        </>
      )}
      <NeedsColor items={ledger.needsColor} onSetColor={onSetColor} />
    </div>
  );
}
