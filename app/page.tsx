"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView, useScroll, useTransform, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import type { Profile, Review } from "./lib/types";
import { averageGrade, gradeClass, formatDate, GRADE_VALUE } from "./lib/shared";
import { createClient } from "./lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import Logo from "./components/Logo";
import UpgradeModal from "./components/UpgradeModal";
import { Clapperboard, Brain, ClipboardList, TrendingUp, MessageCircle, Dumbbell, Target, Flame, type LucideIcon } from "lucide-react";

const DecisionIQ  = dynamic(() => import("./components/DecisionIQ"), { ssr: false });
const CoachIQ     = dynamic(() => import("./components/CoachIQ"),    { ssr: false });
const FilmLibrary = dynamic(() => import("./components/DecisionIQ").then(m => ({ default: m.FilmLibrary })), { ssr: false });
const Teams       = dynamic(() => import("./components/Teams"),      { ssr: false });
const ParticleField   = dynamic(() => import("./components/LandingEffects").then(m => ({ default: m.ParticleField })),   { ssr: false });
const CursorSpotlight = dynamic(() => import("./components/LandingEffects").then(m => ({ default: m.CursorSpotlight })), { ssr: false });

function fireBurst(e: React.MouseEvent) {
  import("./components/LandingEffects").then(m => m.fireBurst(e));
}

const DEFAULT_PROFILE: Profile = { name: "", sport: "", team: "" };
const MODULES = [
  { id: "decision", label: "DecisionIQ", sub: "Film analysis"     },
  { id: "coach",    label: "CoachIQ",    sub: "Personal coaching" },
  { id: "library",  label: "Library",    sub: "Past reviews"      },
  { id: "teams",    label: "Teams",      sub: "Season & roster"   },
] as const;
type ModuleId = typeof MODULES[number]["id"];

// ─── Profile ──────────────────────────────────────────────────────────────────

function ProfileCard({ profile, onSave, reviews = [] }: { profile: Profile; onSave: (p: Profile) => void; reviews?: Review[] }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(profile);
  function save() { onSave(draft); setEditing(false); }

  if (!profile.name && !editing) {
    return (
      <button
        onClick={() => { setDraft({ name: "", sport: "", team: "", jersey: "" }); setEditing(true); }}
        className="mb-6 w-full border border-dashed border-zinc-800 py-3 text-sm text-zinc-600 hover:border-zinc-600 hover:text-zinc-400 transition-colors rounded-xl"
      >
        Set up your athlete profile
      </button>
    );
  }

  if (editing) {
    return (
      <div className="mb-6 border border-zinc-800 bg-zinc-950 rounded-xl p-5">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-zinc-600">Profile</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="rounded-lg border border-zinc-800 bg-black px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            placeholder="Your name" value={draft.name ?? ""} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
          <input className="rounded-lg border border-zinc-800 bg-black px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            placeholder="Primary sport" value={draft.sport ?? ""} onChange={e => setDraft(d => ({ ...d, sport: e.target.value }))} />
          <input className="rounded-lg border border-zinc-800 bg-black px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            placeholder="Team / school" value={draft.team ?? ""} onChange={e => setDraft(d => ({ ...d, team: e.target.value }))} />
          <input className="rounded-lg border border-zinc-800 bg-black px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            placeholder="Jersey number (e.g. 23) — tracks your grades over time"
            value={draft.jersey ?? ""} onChange={e => setDraft(d => ({ ...d, jersey: e.target.value }))} />
          <input className="rounded-lg border border-zinc-800 bg-black px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            placeholder="Position (e.g. Point Guard)"
            value={draft.position ?? ""} onChange={e => setDraft(d => ({ ...d, position: e.target.value }))} />
          <input className="rounded-lg border border-zinc-800 bg-black px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            placeholder="Team jersey colors (e.g. White, or 'mixed white + blue')"
            value={draft.teamColor ?? ""} onChange={e => setDraft(d => ({ ...d, teamColor: e.target.value }))} />
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={save} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-100 transition-colors">Save</button>
          <button onClick={() => setEditing(false)} className="rounded-lg px-4 py-2 text-sm text-zinc-500 hover:text-white transition-colors">Cancel</button>
        </div>
      </div>
    );
  }

  const avg = averageGrade(reviews.map(r => r.grade).filter(g => g && g !== "N/A"));
  return (
    <div className="mb-6 flex items-center justify-between rounded-2xl border border-zinc-800 bg-gradient-to-r from-zinc-900/70 to-zinc-950 px-4 py-3.5">
      <div className="flex items-center gap-3.5 min-w-0">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-white to-zinc-400 text-black text-sm font-black shadow-lg shadow-white/10">
          {profile.jersey ? `#${profile.jersey}` : profile.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">{profile.name}</p>
          <p className="truncate text-xs text-zinc-500">
            {[profile.sport, profile.team].filter(Boolean).join(" · ") || "Athlete"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {reviews.length > 0 && (
          <>
            <div className="hidden sm:flex flex-col items-center rounded-xl border border-zinc-800 bg-black/40 px-3 py-1.5">
              <span className="text-sm font-black text-white leading-tight">{reviews.length}</span>
              <span className="text-[9px] uppercase tracking-widest text-zinc-600">clips</span>
            </div>
            {avg !== "N/A" && (
              <div className="hidden sm:flex flex-col items-center rounded-xl border border-zinc-800 bg-black/40 px-3 py-1.5">
                <span className="text-sm font-black leading-tight text-white">{avg}</span>
                <span className="text-[9px] uppercase tracking-widest text-zinc-600">avg grade</span>
              </div>
            )}
          </>
        )}
        <button onClick={() => { setDraft(profile); setEditing(true); }}
          className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-500 hover:text-white hover:border-zinc-600 transition-colors">
          Edit
        </button>
      </div>
    </div>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function calcStreak(reviews: Review[]): number {
  if (reviews.length === 0) return 0;
  const days = Array.from(new Set(
    reviews.map(r => new Date(r.timestamp).toDateString())
  )).map(d => new Date(d).getTime()).sort((a, b) => b - a);
  const today = new Date(); today.setHours(0,0,0,0);
  const todayMs = today.getTime();
  const MS_DAY = 86400000;
  // streak starts only if uploaded today or yesterday
  if (days[0] < todayMs - MS_DAY) return 0;
  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    if (days[i - 1] - days[i] === MS_DAY) streak++;
    else break;
  }
  return streak;
}

function StatsBar({ reviews }: { reviews: Review[] }) {
  if (reviews.length === 0) return null;
  const allGrades = reviews.map(r => r.grade).filter(g => g && g !== "N/A");
  const avg       = averageGrade(allGrades);
  const sportCounts: Record<string, number> = {};
  for (const r of reviews) {
    const s = (r.sport || "Unknown").toLowerCase();
    sportCounts[s] = (sportCounts[s] ?? 0) + 1;
  }
  const topSport = Object.entries(sportCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  const streak = calcStreak(reviews);

  const stats = [
    { label: "Clips",      value: String(reviews.filter(r => r.mode === "clip").length), grade: false, fire: false },
    { label: "Games",      value: String(reviews.filter(r => r.mode === "game").length), grade: false, fire: false },
    { label: "Avg Grade",  value: avg,      grade: true,  fire: false },
    { label: "This Week",  value: streak > 0 ? `${streak} day${streak !== 1 ? "s" : ""}` : topSport, grade: false, fire: streak > 1 },
  ];

  return (
    <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {stats.map(({ label, value, grade, fire }) => (
        <div key={label} className="border border-zinc-800 bg-zinc-950 rounded-xl px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mb-1">{label}</p>
          {grade
            ? <span className={`inline-block rounded-md px-2.5 py-0.5 text-lg font-bold ${gradeClass(value, "bg")} ${gradeClass(value, "text")}`}>{value}</span>
            : <p className="flex items-center gap-1 text-xl font-bold text-white capitalize">{value}{fire ? <Flame className="h-4 w-4 text-orange-500" /> : null}</p>
          }
        </div>
      ))}
    </div>
  );
}

// ─── Grade Trend Chart ────────────────────────────────────────────────────────

function GradeTrendChart({ reviews }: { reviews: Review[] }) {
  const recent = [...reviews].reverse().slice(-20);
  if (recent.length < 2) return null;

  const W = 600, H = 120, PL = 28, PR = 12, PT = 12, PB = 24;
  const iW = W - PL - PR, iH = H - PT - PB;
  const xp = (i: number) => PL + (i / (recent.length - 1)) * iW;
  const yp = (v: number) => PT + iH - ((v - 1) / 12) * iH;
  const vals  = recent.map(r => GRADE_VALUE[r.grade] ?? 0);
  const first = vals[0] ?? 0, last = vals[vals.length - 1] ?? 0;
  const color = last > first ? "#22c55e" : last < first ? "#ef4444" : "#52525b";
  const pts   = recent.map((r, i) => ({ x: xp(i), y: yp(GRADE_VALUE[r.grade] ?? 0), r }));
  const poly  = pts.map(p => `${p.x},${p.y}`).join(" ");

  return (
    <div className="mb-5 border border-zinc-800 bg-zinc-950 rounded-xl p-4">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Grade Trend</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 110 }}>
        {[{ v: 13, l: "A+" }, { v: 9, l: "B" }, { v: 6, l: "C" }, { v: 1, l: "F" }].map(({ v, l }) => (
          <g key={v}>
            <line x1={PL} y1={yp(v)} x2={W - PR} y2={yp(v)} stroke="#18181b" strokeWidth="1" />
            <text x={PL - 5} y={yp(v) + 4} textAnchor="end" fill="#52525b" fontSize="9">{l}</text>
          </g>
        ))}
        <polyline points={poly} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3" fill={color} stroke="#000" strokeWidth="1.5" />)}
        {[0, Math.floor((recent.length - 1) / 2), recent.length - 1].map(i => (
          <text key={i} x={xp(i)} y={H - 4} textAnchor="middle" fill="#3f3f46" fontSize="9">
            {new Date(recent[i].timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ─── How It Works ─────────────────────────────────────────────────────────────

const HOW_STEPS: Record<"decision" | "coach", { icon: LucideIcon; title: string; desc: string }[]> = {
  decision: [
    { icon: Clapperboard, title: "Upload your footage",      desc: "Short clip or full game — sport, teams, and situation are detected automatically." },
    { icon: Brain, title: "Every player is reviewed", desc: "Everyone on screen gets a grade, a breakdown, and what they should've done instead." },
    { icon: ClipboardList, title: "See the full picture",     desc: "What happened, the better option, and one thing to work on. Games get full reports." },
    { icon: TrendingUp, title: "Track your progress",      desc: "Every review is saved — watch your grade trend climb over time." },
  ],
  coach: [
    { icon: MessageCircle, title: "Ask your coach anything",  desc: "Technique, strategy, mindset — answers specific to your sport and your film." },
    { icon: Dumbbell, title: "Get a real practice plan", desc: "A full week of sessions with specific solo drills and exact reps." },
    { icon: Target, title: "Connected to your film",   desc: "Weaknesses found in your film feed straight into your plan." },
  ],
};

function HowItWorks({ activeModule }: { activeModule: "decision" | "coach" }) {
  const key = `reel-how-open-${activeModule}`;
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem(key);
    return saved === null ? true : saved === "1";
  });
  function toggle() {
    const next = !open;
    setOpen(next);
    localStorage.setItem(key, next ? "1" : "0");
  }
  const steps = HOW_STEPS[activeModule];

  return (
    <div className="mb-6 rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/60 to-zinc-950 overflow-hidden">
      <button onClick={toggle}
        className="flex w-full items-center justify-between px-5 py-4 text-left">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mb-0.5">How it works</p>
          <p className="text-sm font-semibold text-white">
            {activeModule === "decision" ? "From raw footage to real feedback" : "From questions to a real plan"}
          </p>
        </div>
        <span className="rounded-md border border-zinc-800 px-2 py-1 text-[10px] font-semibold text-zinc-500">{open ? "HIDE" : "SHOW"}</span>
      </button>

      {open && (
        <div className="border-t border-zinc-800/60 p-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <div key={s.title} className="group relative rounded-xl border border-zinc-800 bg-black/40 p-4 transition-colors hover:border-zinc-600">
                <div className="mb-3 flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-800/80"><s.icon className="h-4.5 w-4.5 text-zinc-300" strokeWidth={1.75} /></span>
                  <span className="text-[10px] font-black tracking-widest text-zinc-700">0{i + 1}</span>
                </div>
                <p className="text-sm font-semibold text-white mb-1">{s.title}</p>
                <p className="text-xs text-zinc-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>

          {activeModule === "decision" && (
            <p className="text-xs text-zinc-500 leading-relaxed px-1">
              <span className="font-semibold text-zinc-300">DecisionIQ</span> is your film room.{" "}
              <span className="font-semibold text-zinc-300">CoachIQ</span> is your coach on the sideline — analyze a clip, then build a plan around what you found.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

function SettingsPanel({ open, onClose, profile, onSaveProfile, reviews, onClearHistory, user, onSignIn, onSignOut, isPro, onUpgrade }: {
  open: boolean;
  onClose: () => void;
  profile: Profile;
  onSaveProfile: (p: Profile) => void;
  reviews: Review[];
  onClearHistory: () => void;
  user: User | null;
  onSignIn: () => void;
  onSignOut: () => void;
  isPro?: boolean;
  onUpgrade?: () => void;
}) {
  const [draft, setDraft] = useState(profile);
  const [saved, setSaved] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => { setDraft(profile); }, [profile]);

  function save() {
    onSaveProfile(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function exportHistory() {
    const blob = new Blob([JSON.stringify(reviews, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "reel-history.json"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      {/* Backdrop */}
      {open && <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />}

      {/* Drawer */}
      <div className={`fixed top-0 right-0 z-50 h-full w-full max-w-sm bg-zinc-950 border-l border-zinc-800 transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex h-full flex-col overflow-y-auto">

          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
            <p className="text-sm font-semibold text-white">Settings</p>
            <button onClick={onClose} className="text-xs text-zinc-600 hover:text-white transition-colors">Close</button>
          </div>

          <div className="flex-1 space-y-6 p-5">

            {/* Profile */}
            <div>
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Profile</p>
              <div className="space-y-2">
                {(["name", "sport", "team", "jersey"] as const).map(k => (
                  <input key={k}
                    className="w-full rounded-lg border border-zinc-800 bg-black px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
                    placeholder={k === "name" ? "Your name" : k === "sport" ? "Primary sport" : k === "team" ? "Team / school" : "Jersey number (e.g. 23)"}
                    value={draft[k] ?? ""}
                    onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))}
                  />
                ))}
                <button onClick={save}
                  className="w-full rounded-lg bg-white py-2.5 text-sm font-semibold text-black hover:bg-zinc-100 transition-colors">
                  {saved ? "Saved" : "Save Profile"}
                </button>
              </div>
            </div>

            {/* Stats */}
            <div>
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Your Stats</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Total Reviews", value: reviews.length },
                  { label: "Clips", value: reviews.filter(r => r.mode === "clip").length },
                  { label: "Games", value: reviews.filter(r => r.mode === "game").length },
                  { label: "Sports", value: new Set(reviews.map(r => r.sport.toLowerCase())).size },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg border border-zinc-800 px-3 py-2.5">
                    <p className="text-[10px] text-zinc-600 mb-0.5">{label}</p>
                    <p className="text-lg font-bold text-white">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Data */}
            <div>
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Data</p>
              <div className="space-y-2">
                <button onClick={exportHistory} disabled={reviews.length === 0}
                  className="w-full rounded-lg border border-zinc-800 py-2.5 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-30 transition-colors">
                  Export History
                </button>
                {!confirmClear
                  ? <button onClick={() => setConfirmClear(true)} disabled={reviews.length === 0}
                      className="w-full rounded-lg border border-zinc-800 py-2.5 text-sm text-zinc-500 hover:text-red-400 hover:border-red-900 disabled:opacity-30 transition-colors">
                      Clear All History
                    </button>
                  : <div className="rounded-lg border border-red-900 p-3 space-y-2">
                      <p className="text-xs text-zinc-400">Delete all {reviews.length} reviews? This can't be undone.</p>
                      <div className="flex gap-2">
                        <button onClick={() => { onClearHistory(); setConfirmClear(false); onClose(); }}
                          className="flex-1 rounded-lg bg-red-600 py-2 text-xs font-semibold text-white hover:bg-red-700 transition-colors">
                          Delete All
                        </button>
                        <button onClick={() => setConfirmClear(false)}
                          className="flex-1 rounded-lg border border-zinc-700 py-2 text-xs text-zinc-400 hover:text-white transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                }
              </div>
            </div>

            {/* Account */}
            <div>
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Account</p>
              {user ? (
                <div className="space-y-2">
                  <div className="rounded-lg border border-zinc-800 p-3">
                    <p className="text-xs text-zinc-500 mb-0.5">Signed in as</p>
                    <p className="text-sm font-semibold text-white truncate">{user.email}</p>
                  </div>
                  <button onClick={onSignOut}
                    className="w-full rounded-lg border border-zinc-800 py-2.5 text-sm text-zinc-400 hover:text-red-400 hover:border-red-900 transition-colors">
                    Sign Out
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-zinc-500">Sign in to save your history across all devices.</p>
                  <button onClick={onSignIn}
                    className="w-full rounded-lg bg-white py-2.5 text-sm font-semibold text-black hover:bg-zinc-100 transition-colors">
                    Sign in with Google
                  </button>
                </div>
              )}
            </div>


            {/* About */}
            <div>
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">About</p>
              <div className="rounded-lg border border-zinc-800 p-4 space-y-1">
                <Logo size="sm" className="mb-1" />
                <p className="text-xs text-zinc-500">Coaching for every athlete. Any sport, any level.</p>
                <p className="text-xs text-zinc-700 mt-2">Built with DecisionIQ + CoachIQ</p>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}

// ─── Onboarding Overlay ───────────────────────────────────────────────────────

function OnboardingOverlay({ name, onDone }: { name: string; onDone: () => void }) {
  const [step, setStep] = useState(0);

  const slides = [
    {
      eyebrow: "Welcome to Reel",
      title: name ? `Hey ${name}.` : "You're in.",
      body: "This is your personal film room and coaching hub. Everything you need to analyze your game and get better — all in one place.",
      cta: "Show me how →",
    },
    {
      eyebrow: "DecisionIQ",
      title: "Upload a clip. Get real feedback.",
      body: "Drop in any video — a 10-second clip or a full game. DecisionIQ grades every player on screen, breaks down each decision, and tells you exactly what to work on.",
      cta: "Got it →",
    },
    {
      eyebrow: "You're ready",
      title: "Upload your first clip.",
      body: "It takes about 30 seconds. Pick something recent — a play you were proud of, or one you want to understand better.",
      cta: "Upload a clip",
    },
  ];

  const s = slides[step];
  const isLast = step === slides.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/90 backdrop-blur-sm p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-zinc-800 bg-zinc-950 p-8 shadow-2xl">
        {/* Progress */}
        <div className="mb-8 flex gap-1.5">
          {slides.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= step ? "bg-white" : "bg-zinc-800"}`} />
          ))}
        </div>

        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{s.eyebrow}</p>
        <h2 className="mb-3 text-2xl font-black tracking-tight text-white">{s.title}</h2>
        <p className="mb-8 text-sm text-zinc-400 leading-relaxed">{s.body}</p>

        <div className="flex items-center gap-3">
          <button
            onClick={() => isLast ? onDone() : setStep(s => s + 1)}
            className="flex-1 rounded-xl bg-white py-3.5 text-sm font-bold text-black hover:bg-zinc-100 transition-colors"
          >
            {s.cta}
          </button>
          {!isLast && (
            <button onClick={onDone} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
              Skip
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sign Up Modal ────────────────────────────────────────────────────────────

const SPORTS = ["Basketball", "Volleyball", "Soccer", "Football", "Baseball", "Softball", "Lacrosse", "Hockey", "Tennis", "Track & Field", "Swimming", "Wrestling", "Other"];
const LEVELS = ["Middle school", "High school", "Club / AAU", "College", "Pro / Semi-pro"];
const GOALS  = ["Improve decision-making", "Better film breakdown", "Personalized drills", "Track my progress", "Get recruited"];

function SignUpModal({ onContinue, onClose }: { onContinue: (data: { name: string; sport: string; position: string; level: string; goals: string[]; jersey: string; teamColor: string }) => void; onClose: () => void }) {
  const [step,     setStep]     = useState(0);
  const [name,     setName]     = useState("");
  const [sport,    setSport]    = useState("");
  const [position, setPosition] = useState("");
  const [level,    setLevel]    = useState("");
  const [goals,    setGoals]    = useState<string[]>([]);
  const [jersey,   setJersey]   = useState("");
  const [teamColor, setTeamColor] = useState("");

  const steps = [
    {
      title: "What's your name?",
      sub: "We'll personalize your coaching around you.",
      content: (
        <input
          autoFocus
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-400 text-base"
          placeholder="Your first name"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && name.trim() && setStep(1)}
        />
      ),
      canNext: name.trim().length > 0,
    },
    {
      title: `Nice to meet you, ${name || "you"}. What sport do you play?`,
      sub: "Your film analysis and drills will be tailored to your sport.",
      content: (
        <div className="grid grid-cols-2 gap-2">
          {SPORTS.map(s => (
            <button key={s} onClick={() => setSport(s)}
              className={`rounded-xl border px-4 py-3 text-sm font-medium text-left transition-colors ${sport === s ? "border-white bg-white text-black" : "border-zinc-700 text-zinc-300 hover:border-zinc-500"}`}>
              {s}
            </button>
          ))}
        </div>
      ),
      canNext: sport.length > 0,
    },
    {
      title: "What's your position or role?",
      sub: "Optional. Helps us give more specific feedback.",
      content: (
        <input
          autoFocus
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-400 text-base"
          placeholder={`e.g. Point guard, Striker, Quarterback…`}
          value={position}
          onChange={e => setPosition(e.target.value)}
          onKeyDown={e => e.key === "Enter" && setStep(3)}
        />
      ),
      canNext: true, // optional
    },
    {
      title: "Who are you on film?",
      sub: "Your jersey number and team colors let Reel find YOU in the footage and track your grades — not just the team's.",
      content: (
        <div className="flex flex-col gap-2">
          <input
            autoFocus
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-400 text-base"
            placeholder="Jersey number (e.g. 23)"
            value={jersey}
            onChange={e => setJersey(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
            inputMode="numeric"
          />
          <input
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-400 text-base"
            placeholder="Team jersey colors (e.g. White, or 'mixed white + blue pinnies')"
            value={teamColor}
            onChange={e => setTeamColor(e.target.value)}
          />
        </div>
      ),
      canNext: true, // optional
    },
    {
      title: "What level do you compete at?",
      sub: "We'll calibrate feedback to your experience.",
      content: (
        <div className="flex flex-col gap-2">
          {LEVELS.map(l => (
            <button key={l} onClick={() => setLevel(l)}
              className={`rounded-xl border px-4 py-3 text-sm font-medium text-left transition-colors ${level === l ? "border-white bg-white text-black" : "border-zinc-700 text-zinc-300 hover:border-zinc-500"}`}>
              {l}
            </button>
          ))}
        </div>
      ),
      canNext: level.length > 0,
    },
    {
      title: "What are you most looking to improve?",
      sub: "Pick everything that applies.",
      content: (
        <div className="flex flex-col gap-2">
          {GOALS.map(g => {
            const on = goals.includes(g);
            return (
              <button key={g} onClick={() => setGoals(on ? goals.filter(x => x !== g) : [...goals, g])}
                className={`rounded-xl border px-4 py-3 text-sm font-medium text-left transition-colors flex items-center gap-3 ${on ? "border-white bg-white text-black" : "border-zinc-700 text-zinc-300 hover:border-zinc-500"}`}>
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${on ? "border-black bg-black text-white" : "border-zinc-600"}`}>{on ? "✓" : ""}</span>
                {g}
              </button>
            );
          })}
        </div>
      ),
      canNext: goals.length > 0,
    },
  ];

  const current = steps[step];
  const isLast  = step === steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
      <div className="relative w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-zinc-800 bg-zinc-950 p-6 sm:p-8 shadow-2xl max-h-[90dvh] overflow-y-auto">
        {/* Close */}
        <button onClick={onClose} className="absolute right-5 top-5 text-zinc-600 hover:text-white transition-colors text-xl leading-none">✕</button>

        {/* Progress dots */}
        <div className="mb-8 flex gap-1.5">
          {steps.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-white" : "bg-zinc-800"}`} />
          ))}
        </div>

        {/* Content */}
        <h2 className="mb-1 text-xl font-black tracking-tight text-white">{current.title}</h2>
        <p className="mb-6 text-sm text-zinc-500">{current.sub}</p>
        {current.content}

        {/* Actions */}
        <div className="mt-6 flex gap-3">
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)}
              className="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-400 hover:text-white transition-colors">
              Back
            </button>
          )}
          <button
            onClick={() => isLast ? onContinue({ name, sport, position, level, goals, jersey, teamColor }) : setStep(s => s + 1)}
            disabled={!current.canNext}
            className="flex-1 rounded-xl bg-white py-3 text-sm font-bold text-black disabled:opacity-30 hover:bg-zinc-100 transition-colors">
            {isLast ? "Create my account →" : step === 2 ? "Skip" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Animation helpers ────────────────────────────────────────────────────────

function FadeUp({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div ref={ref} className={className}
      initial={{ opacity: 0, y: 40 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay, ease: [0.25, 0.46, 0.45, 0.94] }}>
      {children}
    </motion.div>
  );
}

function TiltCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  function onMouseMove(e: React.MouseEvent) {
    const el = ref.current; if (!el) return;
    const { left, top, width, height } = el.getBoundingClientRect();
    const x = (e.clientX - left) / width - 0.5;
    const y = (e.clientY - top) / height - 0.5;
    el.style.transform = `perspective(800px) rotateY(${x * 12}deg) rotateX(${-y * 12}deg) scale3d(1.03,1.03,1.03)`;
  }
  function onMouseLeave() {
    if (ref.current) ref.current.style.transform = "perspective(800px) rotateY(0deg) rotateX(0deg) scale3d(1,1,1)";
  }
  return (
    <div ref={ref} className={className} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}
      style={{ transition: "transform 0.15s ease", transformStyle: "preserve-3d", willChange: "transform" }}>
      {children}
    </div>
  );
}

function FloatingGradeCard() {
  return (
    <motion.div
      animate={{ y: [0, -14, 0], rotateZ: [-1, 1, -1] }}
      transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      style={{ transformStyle: "preserve-3d", perspective: 800 }}
      className="mx-auto w-72 rounded-2xl border border-zinc-700 bg-zinc-900/80 backdrop-blur-sm p-6 shadow-2xl"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500 text-2xl font-black text-white">A</div>
        <div>
          <p className="font-bold text-white text-sm">White Point Guard</p>
          <p className="text-xs text-zinc-500">Basketball · Drive read</p>
        </div>
      </div>
      <div className="space-y-2">
        <div className="rounded-lg bg-zinc-800 px-3 py-2">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-0.5">What Happened</p>
          <p className="text-xs text-zinc-300">Drove baseline, drew two defenders, kicked to open corner.</p>
        </div>
        <div className="rounded-lg bg-zinc-800 px-3 py-2">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-0.5">Next Time</p>
          <p className="text-xs text-zinc-300">Same read — attack the gap earlier before help arrives.</p>
        </div>
      </div>
    </motion.div>
  );
}

function StatTrackingPanel() {
  const stats = [
    { label: "Decision grade", value: "A-", pct: 88, sub: "this game" },
    { label: "Sharp reads", value: "9", pct: 82, sub: "vs 2 costly" },
    { label: "Fouls", value: "2", pct: 25, sub: "late reaches" },
    { label: "Grade trend", value: "+2", pct: 70, sub: "last 5 clips" },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }} transition={{ duration: 0.7 }}
      className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6 sm:p-8"
    >
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-600">Stat tracking</p>
          <p className="text-lg font-black text-white">This game</p>
        </div>
        <span className="rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-400">↑ trending up</span>
      </div>
      <div className="space-y-4">
        {stats.map((s, i) => (
          <div key={s.label}>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-sm font-semibold text-zinc-300">{s.label}</span>
              <span className="text-sm font-black text-white">{s.value} <span className="text-[11px] font-medium text-zinc-600">{s.sub}</span></span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <motion.div
                initial={{ width: 0 }} whileInView={{ width: `${s.pct}%` }}
                viewport={{ once: true }} transition={{ delay: 0.3 + i * 0.12, duration: 0.8, ease: "easeOut" }}
                className="h-full rounded-full bg-white"
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs leading-relaxed text-zinc-500">
        Every clip is tracked over time — watch your shooting, decisions, and ball security improve week over week.
      </p>
    </motion.div>
  );
}

function AnalysisDemo() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }} transition={{ duration: 0.7 }}
      className="relative overflow-hidden rounded-3xl border border-zinc-800"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/demo-basketball.jpg" alt="Basketball layup being analyzed by Reel" className="block w-full" />

      {/* contrast vignette */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />

      {/* live badge */}
      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        Analyzing film
      </div>

      {/* shooter tracking box */}
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }} whileInView={{ scale: 1, opacity: 1 }}
        viewport={{ once: true }} transition={{ delay: 0.4, type: "spring", stiffness: 120 }}
        className="absolute" style={{ left: "49%", top: "30%", width: "23%", height: "46%" }}
      >
        <div className="h-full w-full rounded-xl border-2 border-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.4)]" />
        <span className="absolute -top-5 left-0 whitespace-nowrap rounded-md bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">#30 · Blue</span>
      </motion.div>

      {/* defender tag */}
      <motion.div
        initial={{ opacity: 0 }} whileInView={{ opacity: 1 }}
        viewport={{ once: true }} transition={{ delay: 0.7 }}
        className="absolute" style={{ left: "30%", top: "39%" }}
      >
        <span className="whitespace-nowrap rounded-md bg-red-500/90 px-2 py-0.5 text-[10px] font-bold text-white shadow-lg">Late contest</span>
      </motion.div>

      {/* grade card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }} transition={{ delay: 0.95 }}
        className="absolute bottom-3 right-3 w-60 max-w-[72%] rounded-2xl border border-zinc-700 bg-zinc-900/85 p-4 shadow-2xl backdrop-blur-md sm:bottom-5 sm:right-5"
      >
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-lg font-black text-white">A-</div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white">#30 · Blue</p>
            <p className="text-xs text-zinc-400">Basketball · Finish at rim</p>
          </div>
        </div>
        <div className="rounded-lg bg-zinc-800 px-3 py-2">
          <p className="mb-0.5 text-[9px] uppercase tracking-widest text-zinc-500">The read</p>
          <p className="text-xs leading-relaxed text-zinc-300">Rose up through contact and drew the foul — aggressive, correct call against a late closeout.</p>
        </div>
      </motion.div>
    </motion.div>
  );
}

function AnimatedGrid() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <svg className="absolute inset-0 h-full w-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="white" strokeWidth="1"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
      {[...Array(6)].map((_, i) => (
        <motion.div key={i}
          className="absolute rounded-full bg-white/5 blur-3xl"
          style={{ width: 300 + i * 80, height: 300 + i * 80, left: `${10 + i * 15}%`, top: `${5 + i * 12}%` }}
          animate={{ x: [0, 30, 0], y: [0, -20, 0], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 6 + i * 1.5, repeat: Infinity, delay: i * 0.8, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

// ─── Scroll zoom section ──────────────────────────────────────────────────────

function ZoomSection({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const scale   = useTransform(scrollYProgress, [0, 0.3, 0.7, 1], [0.82, 1, 1, 0.95]);
  const opacity = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0,    1, 1, 0.4]);
  const y       = useTransform(scrollYProgress, [0, 0.3], [60, 0]);
  return (
    <div ref={ref} className={className}>
      <motion.div style={{ scale, opacity, y }}>
        {children}
      </motion.div>
    </div>
  );
}

// ─── Landing Page ─────────────────────────────────────────────────────────────

function LandingPage({ onSignIn, onSignUp, onEnterApp, signingIn, authError }: { onSignIn: () => void; onSignUp: (data: { name: string; sport: string; position: string; level: string; goals: string[]; jersey: string; teamColor: string }) => void; onEnterApp: () => void; signingIn?: boolean; authError?: string }) {
  const [showSignUp, setShowSignUp] = useState(false);
  const heroRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroScale   = useTransform(scrollYProgress, [0, 1], [1, 1.18]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const heroTextY   = useTransform(scrollYProgress, [0, 1], ["0%", "-20%"]);

  return (
    <div className="bg-black text-white overflow-x-hidden">
      <AnimatePresence>
        {showSignUp && (
          <SignUpModal
            onClose={() => setShowSignUp(false)}
            onContinue={(data) => { setShowSignUp(false); onSignUp(data); }}
          />
        )}
      </AnimatePresence>

      {/* Fixed nav */}
      <motion.header
        initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
        className="fixed top-0 left-0 right-0 z-50 px-6 py-4 backdrop-blur-md bg-black/60 border-b border-white/5">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Logo size="md" />
          <div className="flex items-center gap-3">
            <button onClick={onEnterApp} className="hidden sm:block text-sm text-zinc-500 hover:text-white transition-colors">Try free</button>
            <button onClick={onSignIn} disabled={signingIn}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-50">
              {signingIn ? "…" : "Log in"}
            </button>
            <motion.button onClick={() => setShowSignUp(true)} disabled={signingIn}
              whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.97 }}
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
              Sign up
            </motion.button>
          </div>
        </div>
      </motion.header>

      {/* ── Hero: image zooms in as you scroll down ── */}
      <section ref={heroRef} className="relative h-screen min-h-[600px] overflow-hidden">
        <motion.div style={{ scale: heroScale }} className="absolute inset-0 origin-center">
          <video
            autoPlay muted loop playsInline
            poster="https://images.unsplash.com/photo-1546519638-68e109498ffc?w=1600&q=85&fit=crop&crop=center"
            ref={(el) => { if (el) el.playbackRate = 0.65; }}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ filter: "blur(0.5px)" }}
          >
            <source src="/hero-basketball.mov" type="video/mp4" />
          </video>
        </motion.div>
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/20" />
        <ParticleField />
        <CursorSpotlight />

        <motion.div style={{ opacity: heroOpacity, y: heroTextY }}
          className="relative flex h-full flex-col items-center justify-center px-6 text-center pt-20">
          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.7 }}
            className="mb-5 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
            Coaching for every athlete
          </motion.p>
          <motion.h1 initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.9, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="mb-6 text-5xl font-black leading-[1.05] tracking-tight sm:text-7xl lg:text-[96px]">
            Every athlete<br />deserves a<br /><span className="text-zinc-500">great coach.</span>
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55, duration: 0.7 }}
            className="mx-auto mb-10 max-w-lg text-base text-zinc-400 leading-relaxed sm:text-lg">
            Film analysis. AI coaching. Practice plans. Free to start, for every athlete.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7, duration: 0.7 }}
            className="flex flex-wrap items-center justify-center gap-3">
            <motion.button onClick={(e) => { setShowSignUp(true); fireBurst(e); }} disabled={signingIn}
              whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.96 }}
              className="rounded-xl bg-white px-8 py-4 text-base font-bold text-black shadow-xl shadow-white/10 disabled:opacity-50">
              Get started free
            </motion.button>
            <motion.button onClick={onSignIn} disabled={signingIn}
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              className="rounded-xl border border-zinc-700 px-8 py-4 text-base font-semibold text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors disabled:opacity-50">
              {signingIn ? "Redirecting…" : "Log in"}
            </motion.button>
          </motion.div>
          {authError && <p className="mt-4 text-sm text-red-400">{authError}</p>}
        </motion.div>

        <motion.div animate={{ y: [0, 10, 0], opacity: [0.3, 0.8, 0.3] }} transition={{ duration: 2.2, repeat: Infinity }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-zinc-600">
          <span className="text-xs tracking-widest uppercase">Scroll</span>
          <div className="h-6 w-px bg-zinc-700" />
        </motion.div>
      </section>

      {/* ── Grade card: zooms in from small ── */}
      <ZoomSection className="py-4 px-4 bg-black">
        <div className="mx-auto max-w-6xl rounded-3xl border border-zinc-800 bg-zinc-950 overflow-hidden">
          <div className="grid gap-0 lg:grid-cols-2">
            <div className="p-12 lg:p-16 flex flex-col justify-center">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-zinc-600">What you get</p>
              <h2 className="mb-5 text-3xl font-black tracking-tight sm:text-5xl leading-tight">
                Real grades.<br />Real feedback.<br /><span className="text-zinc-500">Real improvement.</span>
              </h2>
              <p className="text-zinc-500 leading-relaxed mb-8 text-sm sm:text-base">
                Upload any clip and get a full breakdown of every decision — what happened, what the smarter play was, and exactly how to practice it solo.
              </p>
              <motion.button onClick={(e) => { setShowSignUp(true); fireBurst(e); }}
                whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                className="self-start rounded-xl bg-white px-7 py-3.5 text-sm font-bold text-black">
                Analyze your film →
              </motion.button>
            </div>
            <div className="relative flex items-center justify-center overflow-hidden p-12 bg-zinc-900/50" style={{ minHeight: 380 }}>
              <div className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px)",
                  backgroundSize: "28px 28px",
                  maskImage: "radial-gradient(circle at center, black, transparent 75%)",
                  WebkitMaskImage: "radial-gradient(circle at center, black, transparent 75%)",
                }} />
              <div className="relative z-10 w-full max-w-xs">
                <FloatingGradeCard />
              </div>
            </div>
          </div>
        </div>
      </ZoomSection>

      {/* ── Live analysis demo: real photo with fake overlays ── */}
      <ZoomSection className="py-4 px-4 bg-black">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 text-center">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-600">See it in action</p>
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Every decision, graded.</h2>
          </div>
          <div className="grid items-center gap-4 lg:grid-cols-2">
            <StatTrackingPanel />
            <AnalysisDemo />
          </div>
        </div>
      </ZoomSection>

      {/* ── Photo grid: zooms in ── */}
      <ZoomSection className="py-4 px-4 bg-black">
        <div className="mx-auto max-w-6xl grid grid-cols-2 sm:grid-cols-4 rounded-3xl overflow-hidden" style={{ height: 300 }}>
          {[
            { src: "/grid-basketball.jpg", alt: "Driving to the rim" },
            { src: "https://images.unsplash.com/photo-1547347298-4074fc3086f0?w=600&q=80&fit=crop&crop=faces,center", alt: "Volleyball match" },
            { src: "https://images.unsplash.com/photo-1552984439-3067a809a6d4?w=600&q=80&fit=crop&crop=faces,center", alt: "Basketball game" },
            { src: "https://images.unsplash.com/photo-1612872087720-bb876e2e67d1?w=600&q=80&fit=crop&crop=faces,center", alt: "Volleyball spike" },
          ].map(({ src, alt }, i) => (
            <div key={i} className="overflow-hidden relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={alt}
                className="h-full w-full object-cover grayscale brightness-50 hover:grayscale-0 hover:brightness-90 hover:scale-105 transition-all duration-700" />
            </div>
          ))}
        </div>
      </ZoomSection>

      {/* ── Mission: zooms in ── */}
      <ZoomSection className="py-4 px-4 bg-black">
        <div className="mx-auto max-w-6xl rounded-3xl border border-zinc-800 bg-zinc-950 p-10 sm:p-16">
          <div className="grid gap-14 lg:grid-cols-2 items-center">
            <div>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-zinc-600">Our Mission</p>
              <h2 className="mb-6 text-3xl font-black tracking-tight sm:text-4xl lg:text-5xl leading-tight">
                Talent is everywhere.<br /><span className="text-zinc-500">Opportunity isn't.</span>
              </h2>
              <p className="text-zinc-500 leading-relaxed mb-4">
                A private coach can cost $100–$300 an hour. Most young athletes never get access to that level of feedback.
              </p>
              <p className="text-zinc-400 leading-relaxed">
                Reel was built to change that. Upload any clip and get elite-level tactical analysis — free to start, for everyone.
              </p>
            </div>
            <div className="grid gap-4">
              {[
                { stat: "Free to start", desc: "2 free analyses every month, no card required. Upgrade to Reel Pro for unlimited." },
                { stat: "Built for hoops & volleyball", desc: "Best-in-class analysis for basketball and volleyball. Other sports supported in beta." },
                { stat: "Any level", desc: "Middle school to college. Beginners to advanced." },
              ].map(({ stat, desc }, i) => (
                <TiltCard key={stat}>
                  <motion.div className="border border-zinc-800 rounded-2xl p-5 bg-black cursor-default"
                    initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1, duration: 0.6 }} viewport={{ once: true }}>
                    <p className="text-2xl font-black text-white mb-1">{stat}</p>
                    <p className="text-sm text-zinc-500">{desc}</p>
                  </motion.div>
                </TiltCard>
              ))}
            </div>
          </div>
        </div>
      </ZoomSection>

      {/* ── Features: each card zooms in staggered ── */}
      <ZoomSection className="py-4 px-4 bg-black">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-10">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-600">The Platform</p>
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Three tools. One mission.</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {[
              { tag: "Film Analysis", title: "DecisionIQ", icon: Clapperboard,
                desc: "Upload a clip or full game. Every player graded, every decision broken down.",
                features: ["Grades every player on screen", "Full game period breakdowns", "Auto-detects sport & jersey numbers", "Grade trend over time"] },
              { tag: "Personal Coaching", title: "CoachIQ", icon: MessageCircle,
                desc: "Your AI coach, 24/7. Chat or build a full weekly practice plan.",
                features: ["Tailored to your sport & position", "Personalized weekly drill plans", "Solo drills, zero equipment needed", "Speaks like a real coach"] },
              { tag: "Progress Tracking", title: "Film Library", icon: TrendingUp,
                desc: "Every clip saved and graded. See your improvement over weeks.",
                features: ["Grade trend chart", "Stats: clips, avg grade, streak", "Search & filter film history", "Shareable grade cards for TikTok"] },
            ].map(({ tag, title, icon: Icon, desc, features }, i) => (
              <motion.div key={title}
                initial={{ opacity: 0, y: 50, scale: 0.9 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: i * 0.12, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
                viewport={{ once: true }}>
                <TiltCard className="h-full">
                  <div className="border border-zinc-800 rounded-2xl p-8 bg-zinc-950 h-full cursor-default">
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-800/80"><Icon className="h-5 w-5 text-zinc-300" strokeWidth={1.75} /></div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">{tag}</p>
                    <h3 className="mb-3 text-2xl font-black">{title}</h3>
                    <p className="mb-6 text-zinc-500 leading-relaxed text-sm">{desc}</p>
                    <div className="space-y-2.5">
                      {features.map((f) => (
                        <div key={f} className="flex items-start gap-2.5">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-white/60" />
                          <p className="text-sm text-zinc-400">{f}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </TiltCard>
              </motion.div>
            ))}
          </div>
        </div>
      </ZoomSection>

      {/* ── How it works: steps zoom in one by one ── */}
      <ZoomSection className="py-4 px-4 bg-black">
        <div className="mx-auto max-w-6xl rounded-3xl border border-zinc-800 bg-zinc-950 p-10 sm:p-16">
          <div className="text-center mb-12">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-600">Simple by design</p>
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Start in 30 seconds.</h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              { num: "01", title: "Upload your clip", desc: "Drop in any video from your phone. A 10-second clip or a full game — Reel handles both." },
              { num: "02", title: "Get your grade", desc: "Every player graded. Every decision broken down. You see exactly what happened and what to do differently." },
              { num: "03", title: "Train smarter", desc: "Take your feedback to CoachIQ. Build a plan targeting the exact weaknesses your film revealed." },
            ].map((s, i) => (
              <motion.div key={s.num}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.15, duration: 0.6 }}
                viewport={{ once: true }}>
                <TiltCard>
                  <div className="rounded-2xl border border-zinc-800 bg-black p-7 cursor-default">
                    <p className="mb-4 text-5xl font-black text-zinc-800">{s.num}</p>
                    <p className="mb-2 text-base font-bold text-white">{s.title}</p>
                    <p className="text-sm text-zinc-500 leading-relaxed">{s.desc}</p>
                  </div>
                </TiltCard>
              </motion.div>
            ))}
          </div>
        </div>
      </ZoomSection>

      {/* ── CTA: big zoom in ── */}
      <ZoomSection className="py-4 px-4 pb-8 bg-black">
        <div className="relative mx-auto max-w-6xl rounded-3xl overflow-hidden bg-white text-black">
          <div className="absolute inset-0 opacity-5">
            <AnimatedGrid />
          </div>
          <div className="relative px-10 py-20 text-center">
            <h2 className="mb-5 text-4xl font-black tracking-tight sm:text-6xl">
              Your film room.<br />Your coach.<br />Your edge.
            </h2>
            <p className="mb-10 text-zinc-600 text-lg max-w-md mx-auto">
              No experience required. No equipment. No cost. Ever.
            </p>
            <motion.button onClick={(e) => { setShowSignUp(true); fireBurst(e); }}
              whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.97 }}
              className="rounded-xl bg-black text-white px-10 py-4 text-base font-bold shadow-2xl">
              Create free account →
            </motion.button>
            <p className="mt-4 text-sm text-zinc-500">
              <button onClick={onEnterApp} className="underline underline-offset-2 hover:text-zinc-800 transition-colors">Try without an account</button>
            </p>
          </div>
        </div>
      </ZoomSection>

      {/* Footer */}
      <footer className="border-t border-zinc-900 px-6 py-8 bg-black">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Logo size="sm" className="opacity-30" />
          <p className="text-xs text-zinc-700">Coaching for every athlete.</p>
        </div>
      </footer>
    </div>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export default function Reel() {
  const [activeModule,  setActiveModule]  = useState<ModuleId>("decision");
  const [profile,       setProfile]       = useState<Profile>(DEFAULT_PROFILE);
  const [reviews,       setReviews]       = useState<Review[]>([]);
  const [settingsOpen,  setSettingsOpen]  = useState(false);
  const [user,          setUser]          = useState<User | null>(null);
  const [authLoading,   setAuthLoading]   = useState(true);
  const [showApp,       setShowApp]       = useState(false);
  const [authError,     setAuthError]     = useState("");
  const [signingIn,     setSigningIn]     = useState(false);
  const [showOnboarding,  setShowOnboarding]  = useState(false);
  const [showUpgrade,     setShowUpgrade]     = useState(false);
  const [isPro,           setIsPro]           = useState(false);
  const [upgradeSuccess,  setUpgradeSuccess]  = useState(false);

  const supabase = createClient();

  useEffect(() => {
    // Load local data
    const p = localStorage.getItem("decisioniq-profile");
    if (p) setProfile(JSON.parse(p));
    const r = localStorage.getItem("decisioniq-reviews");
    if (r) setReviews(JSON.parse(r));

    // Check for Stripe upgrade success
    const params = new URLSearchParams(window.location.search);
    if (params.get("upgraded") === "1") {
      setUpgradeSuccess(true);
      setIsPro(true);
      window.history.replaceState({}, "", "/");
      setTimeout(() => setUpgradeSuccess(false), 5000);
    }

    // Check for auth error passed back from callback
    const authErr = params.get("auth_error");
    if (authErr) {
      setAuthError(decodeURIComponent(authErr));
      setAuthLoading(false);
      window.history.replaceState({}, "", "/");
      return;
    }

    // Listen for auth changes — fires immediately with INITIAL_SESSION
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
        setAuthLoading(false);
        if (u) {
          setShowApp(true);
          loadUserData(u.id);
          if (!localStorage.getItem("reel-onboarded")) setShowOnboarding(true);
          // Load pro status
          fetch(`/api/usage?userId=${u.id}`)
            .then(r => r.json())
            .then(d => setIsPro(d.is_pro ?? false))
            .catch(() => {});
        }
      }
      if (event === "SIGNED_OUT") {
        setUser(null);
        setShowApp(false);
      }
    });

    // Fallback: if onAuthStateChange never fires, stop loading after 3s
    const fallback = setTimeout(() => setAuthLoading(false), 3000);

    return () => { subscription.unsubscribe(); clearTimeout(fallback); };
  }, []);

  async function loadUserData(userId: string) {
    // Apply signup personalization data if present
    const signupRaw = localStorage.getItem("reel-signup-data");
    if (signupRaw) {
      try {
        const signup = JSON.parse(signupRaw);
        const p: Profile = {
          name: signup.name || "", sport: signup.sport || "", team: "",
          jersey: signup.jersey || "", position: signup.position || "", teamColor: signup.teamColor || "",
        };
        setProfile(p);
        localStorage.setItem("decisioniq-profile", JSON.stringify(p));
        localStorage.removeItem("reel-signup-data");
        // Upsert to Supabase
        await supabase.from("profiles").upsert({ id: userId, name: p.name, sport: p.sport, team: p.team });
        return;
      } catch { /* fallthrough to normal load */ }
    }

    // Load profile from Supabase
    const { data: profileData } = await supabase
      .from("profiles").select("*").eq("id", userId).single();
    if (profileData) {
      const p = { name: profileData.name || "", sport: profileData.sport || "", team: profileData.team || "", jersey: profileData.jersey || "", position: profileData.position || "", teamColor: profileData.teamColor || "" };
      setProfile(p);
      localStorage.setItem("decisioniq-profile", JSON.stringify(p));
    }

    // Load reviews from Supabase
    const { data: reviewsData } = await supabase
      .from("reviews").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (reviewsData && reviewsData.length > 0) {
      const mapped: Review[] = reviewsData.map(r => ({
        id: r.id, fileName: r.file_name, sport: r.sport, mode: r.mode,
        grade: r.grade, timestamp: new Date(r.created_at).getTime(),
        teamId: r.team_id, opponentName: r.opponent_name, gameType: r.game_type,
        gameDate: r.game_date, location: r.location,
        ...(r.data || {}),
      }));
      setReviews(mapped);
      localStorage.setItem("decisioniq-reviews", JSON.stringify(mapped));
    }
  }

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "decisioniq-reviews" && e.newValue) setReviews(JSON.parse(e.newValue));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  async function signInWithGoogle() {
    setSigningIn(true);
    setAuthError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) { setAuthError("Couldn't connect to Google. Try again."); setSigningIn(false); }
  }

  async function signUpWithGoogle(data: { name: string; sport: string; position: string; level: string; goals: string[]; jersey: string; teamColor: string }) {
    setSigningIn(true);
    setAuthError("");
    localStorage.setItem("reel-signup-data", JSON.stringify(data));
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) { setAuthError("Couldn't connect to Google. Try again."); setSigningIn(false); }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
  }

  async function saveProfile(p: Profile) {
    setProfile(p);
    localStorage.setItem("decisioniq-profile", JSON.stringify(p));
    if (user) {
      await supabase.from("profiles").upsert({ id: user.id, ...p });
    }
  }

  function clearHistory() {
    setReviews([]);
    localStorage.removeItem("decisioniq-reviews");
    if (user) supabase.from("reviews").delete().eq("user_id", user.id);
  }

  // Show loading spinner briefly
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <p className="text-zinc-700 text-sm animate-pulse">Loading…</p>
      </div>
    );
  }

  // Show landing page if not signed in and hasn't clicked "try"
  if (!showApp) {
    return <LandingPage onSignIn={signInWithGoogle} onSignUp={signUpWithGoogle} onEnterApp={() => setShowApp(true)} signingIn={signingIn} authError={authError} />;
  }

  function dismissOnboarding() {
    localStorage.setItem("reel-onboarded", "1");
    setShowOnboarding(false);
  }

  return (
    <main className="min-h-screen bg-black text-white">

      {showOnboarding && (
        <OnboardingOverlay name={profile.name} onDone={dismissOnboarding} />
      )}

      {showUpgrade && (
        <UpgradeModal user={user} onClose={() => setShowUpgrade(false)} />
      )}

      {/* Upgrade success toast */}
      {upgradeSuccess && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-emerald-800 bg-emerald-950 px-5 py-3 shadow-2xl">
          <span className="text-emerald-400 text-lg">✓</span>
          <p className="text-sm font-semibold text-white">Welcome to Reel Pro! Unlimited film, unlimited growth.</p>
        </div>
      )}

      {/* Settings panel */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        profile={profile}
        onSaveProfile={saveProfile}
        reviews={reviews}
        onClearHistory={clearHistory}
        user={user}
        onSignIn={signInWithGoogle}
        onSignOut={signOut}
        isPro={isPro}
        onUpgrade={() => setShowUpgrade(true)}
      />

      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-zinc-900 bg-black/95 backdrop-blur px-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between h-14">

          <div className="flex items-center gap-3">
            <Logo size="sm" />
            {isPro && (
              <span className="rounded-full bg-emerald-500/15 border border-emerald-800 px-2 py-0.5 text-[10px] font-bold text-emerald-400 tracking-wide">PRO</span>
            )}
          </div>

          <nav className="flex gap-0.5 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
            {MODULES.map(mod => (
              <button key={mod.id} onClick={() => setActiveModule(mod.id)}
                data-module={mod.id}
                className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors sm:px-4 ${
                  activeModule === mod.id ? "bg-white text-black" : "text-zinc-500 hover:text-white"
                }`}
              >
                {mod.label}
              </button>
            ))}
          </nav>

          <button onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-2 rounded-full border border-zinc-800 text-zinc-500 hover:text-white hover:border-zinc-600 transition-colors h-9 px-2"
            aria-label="Settings">
            {user?.user_metadata?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.user_metadata.avatar_url} alt="Your avatar"
                className="h-6 w-6 rounded-full object-cover" referrerPolicy="no-referrer" />
            ) : user ? (
              <span className="h-6 w-6 flex items-center justify-center rounded-full bg-emerald-500 text-white text-[10px] font-bold shrink-0">
                {(user.email || "?").charAt(0).toUpperCase()}
              </span>
            ) : null}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0">
              <path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .205 1.251l-1.18 2.044a1 1 0 0 1-1.186.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.113a7.047 7.047 0 0 1 0-2.228L1.821 7.773a1 1 0 0 1-.205-1.251l1.18-2.044a1 1 0 0 1 1.186-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">

        {activeModule === "library" ? (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Library
                <span className="ml-2 text-base font-normal text-zinc-600">by Reel</span>
              </h1>
              <p className="mt-1 text-sm text-zinc-500">All your past film sessions — search, filter, and replay any review.</p>
            </div>
            <StatsBar reviews={reviews} />
            {reviews.length >= 2 && <GradeTrendChart reviews={reviews} />}
            <FilmLibrary reviews={reviews} onReviewsChange={setReviews} userId={user?.id} />
          </>
        ) : activeModule === "teams" ? (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Teams
                <span className="ml-2 text-base font-normal text-zinc-600">by Reel</span>
              </h1>
              <p className="mt-1 text-sm text-zinc-500">Track a season, roster, and record across every game you upload.</p>
            </div>
            <Teams userId={user?.id} sport={profile.sport} reviews={reviews} onReviewsChange={setReviews} />
          </>
        ) : (
          <>
            {/* Module header */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                {activeModule === "decision" ? "DecisionIQ" : "CoachIQ"}
                <span className="ml-2 text-base font-normal text-zinc-600">by Reel</span>
              </h1>
              <p className="mt-1 text-sm text-zinc-500">
                {activeModule === "decision"
                  ? "Upload a clip or full game. Every player gets analyzed: offense, defense, and everything in between."
                  : "Your personal coach. Ask anything, or build a custom practice plan tailored to your game."}
              </p>
            </div>

            <HowItWorks activeModule={activeModule as "decision" | "coach"} />
            <ProfileCard profile={profile} onSave={saveProfile} reviews={reviews} />

            {activeModule === "decision" && <DecisionIQ profile={profile} reviews={reviews} onReviewsChange={setReviews} userId={user?.id} isPro={isPro} onShowUpgrade={() => setShowUpgrade(true)} />}
            {activeModule === "coach"    && <CoachIQ    profile={profile} reviews={reviews} />}
          </>
        )}
      </div>
    </main>
  );
}
