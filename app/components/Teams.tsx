"use client";

import { useEffect, useState } from "react";
import { Users, Plus, MapPin, Calendar, ChevronLeft, Loader2, Pencil, Trash2 } from "lucide-react";
import { createClient } from "../lib/supabase/client";
import type { Team, TeamMember, Review } from "../lib/types";
import { formatDate } from "../lib/decisioniq-helpers";

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

// Best-effort record from linked games — only counts games where the AI clearly
// identified a winner. We don't fabricate PPG/point differential from data that
// isn't reliably there (teamComparison.stats are ad-hoc observed counts, not a
// real box score) — same honesty stance as the grading prompts.
function computeSeasonRecord(team: Team, reviews: Review[]) {
  const games = reviews.filter(r => r.teamId === team.id && r.mode === "game" && r.gameReport?.teamComparison);
  let wins = 0, losses = 0, unclear = 0;
  for (const g of games) {
    const tc = g.gameReport!.teamComparison!;
    const winner = (tc.winner || "").toLowerCase().trim();
    if (!winner || winner === "unclear") { unclear++; continue; }
    const teamName = team.name.toLowerCase();
    const oppName  = (g.opponentName || tc.teamB || "").toLowerCase();
    if (winner && teamName && (winner.includes(teamName) || teamName.includes(winner))) wins++;
    else if (winner && oppName && (winner.includes(oppName) || oppName.includes(winner))) losses++;
    else unclear++;
  }
  return { wins, losses, unclear, total: games.length };
}

export default function Teams({ userId, sport, reviews, onReviewsChange }: {
  userId?: string; sport?: string; reviews: Review[]; onReviewsChange: (r: Review[]) => void;
}) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [openTeam, setOpenTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);

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

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-zinc-600" /></div>;
  }

  if (openTeam) {
    const record = computeSeasonRecord(openTeam, reviews);
    const games = reviews.filter(r => r.teamId === openTeam.id).sort((a, b) => b.timestamp - a.timestamp);
    return (
      <div>
        <button onClick={() => setOpenTeam(null)} className="mb-4 flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white">
          <ChevronLeft className="h-4 w-4" /> All teams
        </button>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 mb-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-black text-white">{openTeam.name}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                {(openTeam.city || openTeam.state) && (
                  <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{[openTeam.city, openTeam.state].filter(Boolean).join(", ")}</span>
                )}
                {openTeam.season && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{openTeam.season}</span>}
                {openTeam.gender && <span>{openTeam.gender}</span>}
                {openTeam.ageGroup && <span>{openTeam.ageGroup}</span>}
                {openTeam.level && <span>{openTeam.level}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => setShowEdit(true)}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2.5 py-1.5 text-xs font-semibold text-zinc-400 hover:text-white hover:border-zinc-600">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
              <button onClick={() => deleteTeam(openTeam)}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2.5 py-1.5 text-xs font-semibold text-zinc-400 hover:text-red-400 hover:border-red-900">
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mb-1">Record</p>
              <p className="text-lg font-bold text-white">{record.total > 0 ? `${record.wins}-${record.losses}` : "-"}</p>
              {record.unclear > 0 && <p className="text-[10px] text-zinc-600 mt-0.5">{record.unclear} unclear</p>}
            </div>
            <div className="rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mb-1">Games Tracked</p>
              <p className="text-lg font-bold text-white">{games.length || "-"}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mb-1">Roster</p>
              <p className="text-lg font-bold text-white">{members.length || "-"}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mb-1">PPG / Opp PPG</p>
              <p className="text-lg font-bold text-zinc-600">Not tracked yet</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <h3 className="mb-3 text-sm font-bold text-white">Roster</h3>
            <RosterEditor members={members} onAdd={(m) => addMember(openTeam.id, m)} onRemove={removeMember} />
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <h3 className="mb-3 text-sm font-bold text-white">Games</h3>
            {games.length === 0 ? (
              <p className="text-sm text-zinc-500">No games linked to this team yet. When uploading in DecisionIQ, attach the game to this team to see it here.</p>
            ) : (
              <div className="space-y-2">
                {games.map(g => (
                  <div key={g.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-black/30 px-3 py-2">
                    <div>
                      <p className="text-sm text-white">{g.opponentName ? `vs ${g.opponentName}` : g.fileName}</p>
                      <p className="text-xs text-zinc-600">{g.gameDate ? formatDate(new Date(g.gameDate).getTime()) : formatDate(g.timestamp)}</p>
                    </div>
                    <span className="text-sm font-bold text-white">{g.grade}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {showEdit && (
          <CreateTeamModal
            title="Edit Team"
            initial={openTeam}
            onClose={() => setShowEdit(false)}
            onCreate={updateTeam}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">My Teams</h2>
          <p className="text-sm text-zinc-500">Track a season, roster, and record across every game you upload.</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-sm font-bold text-black hover:bg-zinc-100">
          <Plus className="h-4 w-4" /> Create Team
        </button>
      </div>

      {teams.length === 0 && !showCreate && (
        <div className="rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/60 to-zinc-950 p-10 flex flex-col items-center justify-center text-center gap-3">
          <Users className="h-9 w-9 text-zinc-600" strokeWidth={1.5} />
          <p className="text-base font-semibold text-white">No teams yet</p>
          <p className="text-sm text-zinc-500 max-w-xs">Create a team to track a season — roster, record, and every game you upload in one place.</p>
        </div>
      )}

      {teams.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map(t => {
            const record = computeSeasonRecord(t, reviews);
            return (
              <button key={t.id} onClick={() => setOpenTeam(t)}
                className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-left transition-colors hover:border-zinc-600">
                <p className="font-bold text-white">{t.name}</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {[t.ageGroup, t.gender, t.season].filter(Boolean).join(" · ") || "No details yet"}
                </p>
                {(t.city || t.state) && <p className="mt-1 text-xs text-zinc-600">{[t.city, t.state].filter(Boolean).join(", ")}</p>}
                <p className="mt-3 text-sm font-semibold text-zinc-300">{record.total > 0 ? `${record.wins}-${record.losses}` : "No games tracked"}</p>
              </button>
            );
          })}
        </div>
      )}

      {showCreate && <CreateTeamModal defaultSport={sport} onClose={() => setShowCreate(false)} onCreate={createTeam} />}
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
        <p className="mb-3 text-sm text-zinc-500">No players added yet. Jersey number is enough — a name is optional.</p>
      ) : (
        <div className="mb-3 space-y-1.5">
          {members.map(m => (
            <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-black/30 px-3 py-1.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-bold text-white">{m.jerseyNumber ? `#${m.jerseyNumber}` : "—"}</span>
                <span className="text-zinc-400">{m.displayName || "Unnamed player"}</span>
              </div>
              <button onClick={() => onRemove(m.id)} className="text-xs font-semibold text-zinc-600 hover:text-red-400">Remove</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input value={jersey} onChange={e => setJersey(e.target.value)} placeholder="#"
          className="w-16 rounded-lg border border-zinc-800 bg-black px-2 py-1.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-600" />
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (optional)"
          className="flex-1 rounded-lg border border-zinc-800 bg-black px-3 py-1.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-600" />
        <button
          onClick={() => { if (!jersey.trim() && !name.trim()) return; onAdd({ displayName: name, jerseyNumber: jersey }); setName(""); setJersey(""); }}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-zinc-700">Add</button>
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
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6" onClick={e => e.stopPropagation()}>
        <h3 className="mb-4 text-lg font-bold text-white">{title || "Create Team"}</h3>
        <div className="space-y-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Team name — e.g. Titanium 14U"
            className="w-full rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-600" />
          <div className="grid grid-cols-2 gap-3">
            <input value={city} onChange={e => setCity(e.target.value)} placeholder="City"
              className="rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-600" />
            <input value={state} onChange={e => setState(e.target.value)} placeholder="State"
              className="rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-600" />
          </div>
          <input value={season} onChange={e => setSeason(e.target.value)} placeholder="Season — e.g. 2025-26"
            className="w-full rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-600" />
          <div className="grid grid-cols-2 gap-3">
            <select value={gender} onChange={e => setGender(e.target.value)}
              className="rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-white outline-none focus:border-zinc-600">
              <option value="">Gender</option>
              <option value="Boys">Boys</option>
              <option value="Girls">Girls</option>
              <option value="Coed">Coed</option>
            </select>
            <input value={ageGroup} onChange={e => setAgeGroup(e.target.value)} placeholder="Age group — e.g. 14U"
              className="rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-600" />
          </div>
          <select value={level} onChange={e => setLevel(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-white outline-none focus:border-zinc-600">
            <option value="">Level of play</option>
            <option value="Club">Club</option>
            <option value="Rec">Rec</option>
            <option value="School">School</option>
            <option value="Travel">Travel</option>
          </select>
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-zinc-800 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-900">Cancel</button>
          <button
            onClick={() => name.trim() && onCreate({ name, city, state, season, gender, ageGroup, level })}
            disabled={!name.trim()}
            className="flex-1 rounded-lg bg-white py-2.5 text-sm font-bold text-black hover:bg-zinc-100 disabled:opacity-40">
            {initial ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
