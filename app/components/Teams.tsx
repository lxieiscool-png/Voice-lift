"use client";

import { useEffect, useState } from "react";
import { Users, Plus, ChevronLeft, ChevronRight, Loader2, Pencil, Trash2, X } from "lucide-react";
import { createClient } from "../lib/supabase/client";
import type { Team, TeamMember, Review } from "../lib/types";
import { formatDate, gameResult, playedAt } from "../lib/decisioniq-helpers";
import { GameCard, teamAvatarColor, teamInitials } from "./GameCards";
import { Segmented } from "./ui/segmented";
import { GameResultsView, PlayerCardList } from "./DecisionIQ";
import { SeasonStatsPanel, saveReviewTeamColor } from "./SeasonStats";
import { buildSeasonLedger } from "../lib/analysis/seasonStats";

function rowToTeam(r: any): Team {
  return {
    id: r.id, name: r.name, city: r.city, state: r.state, season: r.season,
    gender: r.gender, ageGroup: r.age_group, level: r.level, sport: r.sport,
    coachUserId: r.coach_user_id, isPublic: r.is_public, slug: r.slug,
    createdAt: new Date(r.created_at).getTime(),
  };
}

function rowToMember(r: any): TeamMember {
  return {
    id: r.id, teamId: r.team_id, userId: r.user_id, displayName: r.display_name,
    jerseyNumber: r.jersey_number, role: r.role, createdAt: new Date(r.created_at).getTime(),
  };
}

// Record from linked games. Each result comes from gameResult: the in-video
// scoreboard when it was read, else the AI's called winner. Games with
// neither count as unclear rather than guessed.
function computeSeasonRecord(team: Team, reviews: Review[]) {
  const games = reviews.filter(r => r.teamId === team.id && r.mode === "game");
  let wins = 0, losses = 0, unclear = 0;
  for (const g of games) {
    const res = gameResult(g, team.name);
    if (res?.outcome === "W") wins++;
    else if (res?.outcome === "L") losses++;
    else unclear++;
  }
  return { wins, losses, unclear, total: wins + losses };
}

export default function Teams({ userId, sport, reviews, onReviewsChange, isPro, onShowUpgrade }: {
  userId?: string; sport?: string; reviews: Review[]; onReviewsChange: (r: Review[]) => void;
  isPro?: boolean; onShowUpgrade?: () => void;
}) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [openTeam, setOpenTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [teamTab, setTeamTab] = useState<"stats" | "games" | "roster">("stats");
  const [openReview, setOpenReview] = useState<Review | null>(null);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    const supabase = createClient();
    supabase.from("teams").select("*").eq("coach_user_id", userId).order("created_at", { ascending: false })
      .then(({ data }) => { setTeams((data || []).map(rowToTeam)); setLoading(false); });
  }, [userId]);

  useEffect(() => {
    if (!openTeam) { setMembers([]); return; }
    const supabase = createClient();
    supabase.from("team_members").select("*").eq("team_id", openTeam.id).order("created_at", { ascending: true })
      .then(({ data }) => setMembers((data || []).map(rowToMember)));
  }, [openTeam]);

  async function createTeam(input: { name: string; city: string; state: string; season: string; gender: string; ageGroup: string; level: string }) {
    if (!userId) return;
    // Free plan: one team. The database enforces this too (restrictive RLS
    // policy) — this check just gives the upgrade popup instead of a raw error.
    if (!isPro && teams.length >= 1) {
      setShowCreate(false);
      onShowUpgrade?.();
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase.from("teams").insert({
      name: input.name.trim(), city: input.city.trim() || null, state: input.state.trim() || null,
      season: input.season.trim() || null, gender: input.gender || null, age_group: input.ageGroup.trim() || null,
      level: input.level || null, sport: sport || "basketball", coach_user_id: userId, is_public: false,
    }).select().single();
    if (error) { alert(`Couldn't create team: ${error.message}`); return; }
    const team = rowToTeam(data);
    setTeams([team, ...teams]);
    setShowCreate(false);
    setOpenTeam(team);
  }

  async function updateTeam(input: { name: string; city: string; state: string; season: string; gender: string; ageGroup: string; level: string }) {
    if (!openTeam) return;
    const supabase = createClient();
    const { data, error } = await supabase.from("teams").update({
      name: input.name.trim(), city: input.city.trim() || null, state: input.state.trim() || null,
      season: input.season.trim() || null, gender: input.gender || null, age_group: input.ageGroup.trim() || null,
      level: input.level || null,
    }).eq("id", openTeam.id).select().single();
    if (error) { alert(`Couldn't update team: ${error.message}`); return; }
    const updated = rowToTeam(data);
    setTeams(teams.map(t => t.id === updated.id ? updated : t));
    setOpenTeam(updated);
    setShowEdit(false);
  }

  async function deleteTeam(team: Team) {
    if (!confirm(`Delete "${team.name}"? Games you've uploaded stay in your Library, just unlinked from this team.`)) return;
    const supabase = createClient();
    // Unlink any reviews pointing at this team first — the FK has no cascade,
    // so deleting the team while games still reference it would just fail.
    const { error: unlinkError } = await supabase.from("reviews").update({ team_id: null }).eq("team_id", team.id);
    if (unlinkError) { alert(`Couldn't delete team: ${unlinkError.message}`); return; }
    const { error } = await supabase.from("teams").delete().eq("id", team.id);
    if (error) { alert(`Couldn't delete team: ${error.message}`); return; }
    onReviewsChange(reviews.map(r => r.teamId === team.id ? { ...r, teamId: null } : r));
    setTeams(teams.filter(t => t.id !== team.id));
    setOpenTeam(null);
  }

  async function addMember(teamId: string, input: { displayName: string; jerseyNumber: string }) {
    const supabase = createClient();
    const { data, error } = await supabase.from("team_members").insert({
      team_id: teamId, display_name: input.displayName.trim() || null,
      jersey_number: input.jerseyNumber.trim() || null, role: "player",
    }).select().single();
    if (error) { alert(`Couldn't add player: ${error.message}`); return; }
    setMembers([...members, rowToMember(data)]);
  }

  async function removeMember(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("team_members").delete().eq("id", id);
    if (error) { alert(`Couldn't remove player: ${error.message}`); return; }
    setMembers(members.filter(m => m.id !== id));
  }

  async function setGameColor(review: Review, color: string) {
    if (!await saveReviewTeamColor(userId, review, color)) { alert("Couldn't save that — try again."); return; }
    onReviewsChange(reviews.map(r => r.id === review.id ? { ...r, teamColor: color } : r));
  }

  const reviewOverlay = (
    openReview && (
        openReview.mode === "game" && openReview.gameReport
          ? <GameResultsView report={openReview.gameReport} onClose={() => setOpenReview(null)} backLabel="Back" />
          : (
            <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
              <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6">
                <div className="flex items-center justify-between">
                  <button onClick={() => setOpenReview(null)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-ring transition-colors">
                    ← Back
                  </button>
                  <p className="truncate px-3 text-sm font-black text-foreground">{openReview.fileName || openReview.sport}</p>
                  <button onClick={() => setOpenReview(null)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
                </div>
                {openReview.mode === "clip" && openReview.decisions
                  ? <PlayerCardList decisions={openReview.decisions} />
                  : <p className="text-sm text-muted-foreground">No data saved for this review.</p>}
              </div>
            </div>
          )
      )
  );

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  if (openTeam) {
    const record = computeSeasonRecord(openTeam, reviews);
    const games = reviews.filter(r => r.teamId === openTeam.id).sort((a, b) => playedAt(b) - playedAt(a));
    const { team: teamTotals, sport: statSport, results } = buildSeasonLedger(games, members, openTeam.sport);
    const allScoreboard = results.length > 0 && results.every(r => r.fromScoreboard);
    const meta = [
      [openTeam.city, openTeam.state].filter(Boolean).join(", "), openTeam.season,
      [openTeam.ageGroup, openTeam.gender].filter(Boolean).join(" "), openTeam.level,
    ].filter(Boolean);
    const ppg = statSport === "basketball" && teamTotals.gp > 0
      ? `${(teamTotals.ptsFor / teamTotals.gp).toFixed(1)} / ${teamTotals.gamesWithOpp > 0 ? (teamTotals.ptsAgainst / teamTotals.gamesWithOpp).toFixed(1) : "-"}`
      : "-";
    const strip = [
      { label: "Record", value: record.total > 0 ? `${record.wins}-${record.losses}` : "-", note: record.unclear > 0 ? `${record.unclear} unclear` : null },
      { label: "Games", value: String(games.length || "-"), note: null },
      { label: "Roster", value: String(members.length || "-"), note: null },
      { label: "PPG / Opp", value: ppg, note: ppg !== "-" ? (allScoreboard ? "From scoreboard" : "AI estimate") : null },
    ];
    return (
      <div>
        <button onClick={() => setOpenTeam(null)} className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> All teams
        </button>

        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${teamAvatarColor(openTeam.id)}`}>
              {teamInitials(openTeam.name)}
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-display text-2xl font-bold text-foreground">{openTeam.name}</h2>
              {meta.length > 0 && <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta.join(" · ")}</p>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button onClick={() => setShowEdit(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-ring">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
            <button onClick={() => deleteTeam(openTeam)} aria-label="Delete team"
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:text-red-400 hover:border-red-900">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-y-4 border-y border-border py-4 sm:grid-cols-4">
          {strip.map(t => (
            <div key={t.label}>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t.label}</p>
              <p className="font-display text-xl font-bold text-foreground">{t.value}</p>
              {t.note && <p className="mt-0.5 text-[10px] text-muted-foreground">{t.note}</p>}
            </div>
          ))}
        </div>

        <Segmented className="my-6" value={teamTab} onChange={setTeamTab} options={[
          { value: "stats", label: "Stats" },
          { value: "games", label: "Games", count: games.length },
          { value: "roster", label: "Roster", count: members.length },
        ]} />

        {teamTab === "stats" && (
          <>
            {members.length === 0 && games.length > 0 && (
              <p className="mb-4 text-xs text-muted-foreground">
                Add your roster&apos;s jersey numbers so stats show names and misread numbers get flagged.{" "}
                <button onClick={() => setTeamTab("roster")} className="font-semibold text-foreground underline underline-offset-2">Add roster</button>
              </p>
            )}
            <SeasonStatsPanel games={games} roster={members} sport={openTeam.sport} onSetColor={setGameColor} />
          </>
        )}

        {teamTab === "games" && (
          games.length === 0 ? (
            <p className="text-sm text-muted-foreground">No games linked to this team yet. When analyzing in DecisionIQ, attach the game to this team, or use a game&apos;s ⋮ menu in the Library.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {games.map(g => (
                <GameCard
                  key={g.id}
                  thumbnailUrl={g.thumbnailUrl}
                  sport={g.sport}
                  dateLabel={formatDate(playedAt(g))}
                  title={g.opponentName ? `vs ${g.opponentName}` : (g.fileName || g.sport)}
                  grade={g.grade}
                  result={gameResult(g, openTeam.name)}
                  onClick={() => setOpenReview(g)}
                />
              ))}
            </div>
          )
        )}

        {teamTab === "roster" && (
          <div className="max-w-md">
            <RosterEditor members={members} onAdd={(m) => addMember(openTeam.id, m)} onRemove={removeMember} />
          </div>
        )}

        {showEdit && (
          <CreateTeamModal
            title="Edit Team"
            initial={openTeam}
            onClose={() => setShowEdit(false)}
            onCreate={updateTeam}
          />
        )}
        {reviewOverlay}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{teams.length} {teams.length === 1 ? "team" : "teams"}</p>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Create Team
        </button>
      </div>

      {teams.length === 0 && !showCreate && (
        <div className="flex flex-col items-center justify-center gap-3 border-t border-border py-12 text-center">
          <Users className="h-9 w-9 text-muted-foreground" strokeWidth={1.5} />
          <p className="text-base font-semibold text-foreground">No teams yet</p>
          <p className="text-sm text-muted-foreground max-w-xs">Create a team to track a season: roster, record, and season stats from every game you upload.</p>
        </div>
      )}

      {teams.length > 0 && (
        <div className="border-b border-border">
          {teams.map(t => {
            const record = computeSeasonRecord(t, reviews);
            const games = reviews.filter(r => r.teamId === t.id);
            const { team: totals, sport: statSport } = buildSeasonLedger(games, [], t.sport);
            const subtitle = [[t.ageGroup, t.gender].filter(Boolean).join(" "), t.season, t.level].filter(Boolean).join(" · ");
            const cells = [
              { label: "Record", value: record.total > 0 ? `${record.wins}-${record.losses}` : "-" },
              { label: "Games", value: String(games.filter(g => g.mode === "game").length) },
              { label: "PPG", value: statSport === "basketball" && totals.gp > 0 ? (totals.ptsFor / totals.gp).toFixed(1) : "-" },
            ];
            return (
              <button key={t.id} onClick={() => { setOpenTeam(t); setTeamTab("stats"); }}
                className="flex w-full items-center gap-3 border-t border-border px-1 py-4 text-left transition-colors hover:bg-muted/40">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${teamAvatarColor(t.id)}`}>
                  {teamInitials(t.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-base font-bold text-foreground">{t.name}</span>
                  {subtitle && <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>}
                </span>
                <span className="hidden gap-8 text-right sm:flex">
                  {cells.map(c => (
                    <span key={c.label} className="w-14">
                      <span className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{c.label}</span>
                      <span className="block font-display text-sm font-bold text-foreground">{c.value}</span>
                    </span>
                  ))}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      )}

      {showCreate && <CreateTeamModal defaultSport={sport} onClose={() => setShowCreate(false)} onCreate={createTeam} />}

      {reviewOverlay}
    </div>
  );
}

function RosterEditor({ members, onAdd, onRemove }: {
  members: TeamMember[]; onAdd: (m: { displayName: string; jerseyNumber: string }) => void; onRemove: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [jersey, setJersey] = useState("");
  return (
    <div>
      {members.length === 0 ? (
        <p className="mb-3 text-sm text-muted-foreground">No players added yet. Jersey number is enough — a name is optional.</p>
      ) : (
        <div className="mb-4 divide-y divide-border border-y border-border">
          {[...members].sort((a, b) => Number(a.jerseyNumber ?? 999) - Number(b.jerseyNumber ?? 999)).map(m => (
            <div key={m.id} className="flex items-center justify-between gap-2 px-1 py-2 text-sm">
              <div className="flex items-center gap-3">
                <span className="w-8 font-mono text-muted-foreground">{m.jerseyNumber ? `#${m.jerseyNumber}` : "—"}</span>
                <span className="text-muted-foreground">{m.displayName || "Unnamed player"}</span>
              </div>
              <button onClick={() => onRemove(m.id)} className="text-xs font-semibold text-muted-foreground hover:text-red-400">Remove</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input value={jersey} onChange={e => setJersey(e.target.value)} placeholder="#"
          className="w-16 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-ring" />
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (optional)"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-ring" />
        <button
          onClick={() => { if (!jersey.trim() && !name.trim()) return; onAdd({ displayName: name, jerseyNumber: jersey }); setName(""); setJersey(""); }}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Add</button>
      </div>
    </div>
  );
}

function CreateTeamModal({ title, defaultSport, initial, onClose, onCreate }: {
  title?: string;
  defaultSport?: string;
  initial?: Team;
  onClose: () => void;
  onCreate: (input: { name: string; city: string; state: string; season: string; gender: string; ageGroup: string; level: string }) => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [city, setCity] = useState(initial?.city || "");
  const [state, setState] = useState(initial?.state || "");
  const [season, setSeason] = useState(initial?.season || "");
  const [gender, setGender] = useState(initial?.gender || "");
  const [ageGroup, setAgeGroup] = useState(initial?.ageGroup || "");
  const [level, setLevel] = useState(initial?.level || "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6" onClick={e => e.stopPropagation()}>
        <h3 className="mb-4 text-lg font-bold text-foreground">{title || "Create Team"}</h3>
        <div className="space-y-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Team name — e.g. Titanium 14U"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-ring" />
          <div className="grid grid-cols-2 gap-3">
            <input value={city} onChange={e => setCity(e.target.value)} placeholder="City"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-ring" />
            <input value={state} onChange={e => setState(e.target.value)} placeholder="State"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-ring" />
          </div>
          <input value={season} onChange={e => setSeason(e.target.value)} placeholder="Season — e.g. 2025-26"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-ring" />
          <div className="grid grid-cols-2 gap-3">
            <select value={gender} onChange={e => setGender(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring">
              <option value="">Gender</option>
              <option value="Boys">Boys</option>
              <option value="Girls">Girls</option>
              <option value="Coed">Coed</option>
            </select>
            <input value={ageGroup} onChange={e => setAgeGroup(e.target.value)} placeholder="Age group — e.g. 14U"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-ring" />
          </div>
          <select value={level} onChange={e => setLevel(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring">
            <option value="">Level of play</option>
            <option value="Club">Club</option>
            <option value="Rec">Rec</option>
            <option value="School">School</option>
            <option value="Travel">Travel</option>
          </select>
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-border py-2.5 text-sm font-semibold text-foreground hover:bg-muted">Cancel</button>
          <button
            onClick={() => name.trim() && onCreate({ name, city, state, season, gender, ageGroup, level })}
            disabled={!name.trim()}
            className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
            {initial ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
