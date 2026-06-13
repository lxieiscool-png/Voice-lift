"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { Profile, Review } from "./lib/types";
import { averageGrade, gradeClass, formatDate, GRADE_VALUE } from "./lib/shared";
import { createClient } from "./lib/supabase/client";
import type { User } from "@supabase/supabase-js";

const DecisionIQ = dynamic(() => import("./components/DecisionIQ"), { ssr: false });
const CoachIQ    = dynamic(() => import("./components/CoachIQ"),    { ssr: false });

const DEFAULT_PROFILE: Profile = { name: "", sport: "", team: "" };
const MODULES = [
  { id: "decision", label: "DecisionIQ",  sub: "Film analysis"     },
  { id: "coach",    label: "CoachIQ",     sub: "Personal coaching" },
] as const;
type ModuleId = typeof MODULES[number]["id"];

// ─── Profile ──────────────────────────────────────────────────────────────────

function ProfileCard({ profile, onSave }: { profile: Profile; onSave: (p: Profile) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(profile);
  function save() { onSave(draft); setEditing(false); }

  if (!profile.name && !editing) {
    return (
      <button
        onClick={() => { setDraft({ name: "", sport: "", team: "" }); setEditing(true); }}
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
        <div className="grid gap-2 sm:grid-cols-3">
          {(["name","sport","team"] as const).map(k => (
            <input key={k}
              className="rounded-lg border border-zinc-800 bg-black px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              placeholder={k === "name" ? "Your name" : k === "sport" ? "Primary sport" : "Team / school"}
              value={draft[k]}
              onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))}
            />
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={save} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-100 transition-colors">Save</button>
          <button onClick={() => setEditing(false)} className="rounded-lg px-4 py-2 text-sm text-zinc-500 hover:text-white transition-colors">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 flex items-center justify-between border border-zinc-800 bg-zinc-950 rounded-xl px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded-full bg-white text-black text-sm font-bold">
          {profile.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{profile.name}</p>
          <p className="text-xs text-zinc-500">
            {[profile.sport, profile.team].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <button onClick={() => { setDraft(profile); setEditing(true); }}
        className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors">
        Edit
      </button>
    </div>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

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

  const stats = [
    { label: "Clips",      value: String(reviews.filter(r => r.mode === "clip").length), grade: false },
    { label: "Games",      value: String(reviews.filter(r => r.mode === "game").length), grade: false },
    { label: "Avg Grade",  value: avg,     grade: true  },
    { label: "Top Sport",  value: topSport, grade: false },
  ];

  return (
    <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {stats.map(({ label, value, grade }) => (
        <div key={label} className="border border-zinc-800 bg-zinc-950 rounded-xl px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mb-1">{label}</p>
          {grade
            ? <span className={`inline-block rounded-md px-2.5 py-0.5 text-lg font-bold ${gradeClass(value, "bg")} ${gradeClass(value, "text")}`}>{value}</span>
            : <p className="text-xl font-bold text-white capitalize">{value}</p>
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

const HOW_STEPS: Record<ModuleId, { num: string; title: string; desc: string }[]> = {
  decision: [
    { num: "01", title: "Upload your footage",      desc: "Drop in a short clip or a full game. DecisionIQ figures out the sport, the teams, and the situation automatically." },
    { num: "02", title: "Every player is reviewed", desc: "Every player on screen — offense and defense — gets their own grade, breakdown, and feedback based on what they did and what they could have done instead." },
    { num: "03", title: "See the full picture",     desc: "Each decision card shows what happened, whether it was the right read, the better option, and one thing to work on. Full games get period breakdowns and foul patterns." },
    { num: "04", title: "Track your progress",      desc: "Every review is saved. Over time you can see your grade trend and whether your decision-making is improving." },
  ],
  coach: [
    { num: "01", title: "Ask your coach anything",  desc: "Question about technique, strategy, positioning, or mindset? CoachIQ knows your sport and your film patterns — answers are specific to you." },
    { num: "02", title: "Get a real practice plan", desc: "Tell CoachIQ your position, experience, available days, and what you want to improve. It builds a full week of sessions with specific drills and reps." },
    { num: "03", title: "Connected to your film",   desc: "Patterns found in your DecisionIQ reviews automatically feed into CoachIQ. Your plan targets the exact weaknesses your film identified." },
  ],
};

function HowItWorks({ activeModule }: { activeModule: ModuleId }) {
  const [open, setOpen] = useState(true);
  const steps = HOW_STEPS[activeModule];

  return (
    <div className="mb-6 border border-zinc-800 bg-zinc-950 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-5 py-4 text-left">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mb-0.5">How it works</p>
          <p className="text-sm font-semibold text-white">
            {activeModule === "decision" ? "From raw footage to real feedback" : "From questions to a real plan"}
          </p>
        </div>
        <span className="text-[10px] text-zinc-600">{open ? "HIDE" : "SHOW"}</span>
      </button>

      {open && (
        <div className="border-t border-zinc-800 p-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map(s => (
              <div key={s.num} className="border border-zinc-800 rounded-xl p-4">
                <p className="text-[10px] font-bold text-zinc-700 mb-2 tracking-widest">{s.num}</p>
                <p className="text-sm font-semibold text-white mb-1">{s.title}</p>
                <p className="text-xs text-zinc-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>

          {activeModule === "decision" && (
            <div className="border border-zinc-800 rounded-xl px-4 py-3">
              <p className="text-xs text-zinc-400 leading-relaxed">
                <span className="font-semibold text-white">DecisionIQ</span> is your film room.{" "}
                <span className="font-semibold text-white">CoachIQ</span> is your coach on the sideline. Use both together — analyze a clip, then ask CoachIQ to build a plan around what you found.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

function SettingsPanel({ open, onClose, profile, onSaveProfile, reviews, onClearHistory, user, onSignIn, onSignOut }: {
  open: boolean;
  onClose: () => void;
  profile: Profile;
  onSaveProfile: (p: Profile) => void;
  reviews: Review[];
  onClearHistory: () => void;
  user: User | null;
  onSignIn: () => void;
  onSignOut: () => void;
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
                {(["name", "sport", "team"] as const).map(k => (
                  <input key={k}
                    className="w-full rounded-lg border border-zinc-800 bg-black px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
                    placeholder={k === "name" ? "Your name" : k === "sport" ? "Primary sport" : "Team / school"}
                    value={draft[k]}
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
                <p className="text-sm font-semibold text-white">Reel</p>
                <p className="text-xs text-zinc-500">Coaching for every athlete — any sport, any level.</p>
                <p className="text-xs text-zinc-700 mt-2">Built with DecisionIQ + CoachIQ</p>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}

// ─── Sign Up Modal ────────────────────────────────────────────────────────────

const SPORTS = ["Basketball", "Soccer", "Football", "Baseball", "Softball", "Volleyball", "Lacrosse", "Hockey", "Tennis", "Track & Field", "Swimming", "Wrestling", "Other"];
const LEVELS = ["Middle school", "High school", "College", "Semi-pro / Amateur", "Professional"];
const GOALS  = ["Improve decision-making", "Better film breakdown", "Personalized drills", "Track my progress", "Get recruited"];

function SignUpModal({ onContinue, onClose }: { onContinue: (data: { name: string; sport: string; position: string; level: string; goals: string[] }) => void; onClose: () => void }) {
  const [step,     setStep]     = useState(0);
  const [name,     setName]     = useState("");
  const [sport,    setSport]    = useState("");
  const [position, setPosition] = useState("");
  const [level,    setLevel]    = useState("");
  const [goals,    setGoals]    = useState<string[]>([]);

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
      sub: "Optional — helps us give more specific feedback.",
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-8 shadow-2xl">
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
            onClick={() => isLast ? onContinue({ name, sport, position, level, goals }) : setStep(s => s + 1)}
            disabled={!current.canNext}
            className="flex-1 rounded-xl bg-white py-3 text-sm font-bold text-black disabled:opacity-30 hover:bg-zinc-100 transition-colors">
            {isLast ? "Create my account →" : step === 2 ? "Skip" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Landing Page ─────────────────────────────────────────────────────────────

function LandingPage({ onSignIn, onSignUp, onEnterApp }: { onSignIn: () => void; onSignUp: (data: { name: string; sport: string; position: string; level: string; goals: string[] }) => void; onEnterApp: () => void }) {
  const [showSignUp, setShowSignUp] = useState(false);
  return (
    <div className="min-h-screen bg-black text-white">

      {showSignUp && (
        <SignUpModal
          onClose={() => setShowSignUp(false)}
          onContinue={(data) => { setShowSignUp(false); onSignUp(data); }}
        />
      )}

      {/* Nav */}
      <header className="absolute top-0 left-0 right-0 z-20 px-6 py-5">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <span className="text-2xl font-black tracking-tight">Reel</span>
          <div className="flex items-center gap-3">
            <button onClick={onEnterApp} className="text-sm text-zinc-400 hover:text-white transition-colors">
              Try without account
            </button>
            <button onClick={onSignIn}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors">
              Log in
            </button>
            <button onClick={() => setShowSignUp(true)}
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-100 transition-colors">
              Sign up
            </button>
          </div>
        </div>
      </header>

      {/* Hero — full bleed image */}
      <section className="relative h-screen min-h-[600px] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://images.unsplash.com/photo-1546519638-68e109498ffc?w=1600&q=85&fit=crop&crop=center"
          alt="Basketball player mid-air"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/10" />

        <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
          <p className="mb-5 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
            Coaching for every athlete
          </p>
          <h1 className="mb-6 text-5xl font-black leading-tight tracking-tight sm:text-7xl lg:text-8xl">
            Every athlete<br />deserves a<br />
            <span className="text-zinc-400">great coach.</span>
          </h1>
          <p className="mx-auto mb-10 max-w-xl text-base text-zinc-400 leading-relaxed sm:text-lg">
            Film analysis. Personalized coaching. Practice plans built around your game. All free — for every athlete, everywhere.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <button onClick={() => setShowSignUp(true)}
              className="w-full rounded-xl bg-white px-8 py-4 text-base font-bold text-black hover:bg-zinc-100 transition-colors sm:w-auto">
              Create free account
            </button>
            <button onClick={onSignIn}
              className="w-full rounded-xl border border-zinc-700 px-8 py-4 text-base font-semibold text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors sm:w-auto">
              Log in
            </button>
            <button onClick={onEnterApp}
              className="w-full rounded-xl px-8 py-4 text-base font-semibold text-zinc-500 hover:text-zinc-300 transition-colors sm:w-auto">
              Try without account
            </button>
          </div>
        </div>

        {/* Scroll hint */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-40">
          <div className="h-8 w-px bg-white" />
        </div>
      </section>

      {/* Photo grid */}
      <section className="relative z-10 grid grid-cols-2 sm:grid-cols-4 h-64 sm:h-80">
        {[
          { id: "1629901925121-8a141c2a42f4", alt: "Basketball dunk" },
          { id: "1537882111161-c3379a777c8b", alt: "Football game" },
          { id: "1552984439-3067a809a6d4", alt: "Basketball game" },
          { id: "1489358921548-9b3f69a1eb4a", alt: "Football action" },
        ].map(({ id, alt }) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={id}
            src={`https://images.unsplash.com/photo-${id}?w=600&q=80&fit=crop&crop=faces,center`}
            alt={alt}
            className="h-full w-full object-cover grayscale brightness-50 hover:grayscale-0 hover:brightness-100 transition-all duration-700"
          />
        ))}
      </section>

      {/* Mission */}
      <section className="relative z-10 border-t border-zinc-900 bg-black">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-12 lg:grid-cols-2 items-center">
            <div>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-zinc-600">Our Mission</p>
              <h2 className="mb-5 text-3xl font-black tracking-tight sm:text-4xl">
                Talent is everywhere.<br />
                <span className="text-zinc-500">Opportunity isn't.</span>
              </h2>
              <p className="text-zinc-500 leading-relaxed mb-4">
                A private coach can cost $100–300 an hour. Most young athletes — especially those from low-income families, rural areas, or underserved communities — never get access to that level of feedback.
              </p>
              <p className="text-zinc-400 leading-relaxed">
                Reel was built to change that. Upload any clip or game, and get the same quality of tactical analysis and personalized coaching that elite athletes pay thousands for — for free, for everyone.
              </p>
            </div>
            <div className="grid gap-4">
              {[
                { stat: "Free", desc: "No subscriptions, no paywalls. Always free for athletes." },
                { stat: "Any sport", desc: "Basketball, soccer, football, water polo, lacrosse, volleyball, hockey, and more." },
                { stat: "Any level", desc: "From middle school to college. Beginners to advanced. Everyone gets coached." },
              ].map(({ stat, desc }) => (
                <div key={stat} className="border border-zinc-800 rounded-xl p-5">
                  <p className="text-2xl font-black text-white mb-1">{stat}</p>
                  <p className="text-sm text-zinc-500">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-zinc-900">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-zinc-600 text-center">The Platform</p>
          <h2 className="mb-12 text-center text-3xl font-black tracking-tight sm:text-4xl">Two tools. One mission.</h2>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* DecisionIQ */}
            <div className="border border-zinc-800 rounded-2xl p-8">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Film Analysis</p>
              <h3 className="mb-4 text-2xl font-black">DecisionIQ</h3>
              <p className="mb-6 text-zinc-500 leading-relaxed">
                Upload a clip or a full game. DecisionIQ analyzes every player on screen — offense and defense — grades each decision, and tells you exactly what the better option was and why.
              </p>
              <div className="space-y-3">
                {[
                  "Grades every player, not just the ball handler",
                  "Works on full games — period breakdowns, foul patterns, player stats",
                  "Auto-detects sport, teams, and jersey numbers",
                  "Tracks your grade trend over time",
                ].map(f => (
                  <div key={f} className="flex items-start gap-3">
                    <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-white" />
                    <p className="text-sm text-zinc-400">{f}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* CoachIQ */}
            <div className="border border-zinc-800 rounded-2xl p-8">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Personal Coaching</p>
              <h3 className="mb-4 text-2xl font-black">CoachIQ</h3>
              <p className="mb-6 text-zinc-500 leading-relaxed">
                Your personal coach, available 24/7. Ask anything about technique, strategy, or mindset. Or build a full weekly practice plan — specific drills, reps, and explanations, all tailored to your game.
              </p>
              <div className="space-y-3">
                {[
                  "Knows your sport, position, and recent film patterns",
                  "Builds personalized weekly practice plans",
                  "All drills are solo — no gym, no equipment, no teammates needed",
                  "Speaks directly to you, like a real coach would",
                ].map(f => (
                  <div key={f} className="flex items-start gap-3">
                    <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-white" />
                    <p className="text-sm text-zinc-400">{f}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-zinc-900">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-zinc-600 text-center">Simple by design</p>
          <h2 className="mb-12 text-center text-3xl font-black tracking-tight sm:text-4xl">Start in 30 seconds.</h2>
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              { num: "01", title: "Upload your clip", desc: "Drop in any video from your phone or camera. A 10-second clip or a full game — Reel handles both." },
              { num: "02", title: "Get real feedback", desc: "Every player gets graded. Every decision gets broken down. You see exactly what happened and what to do differently." },
              { num: "03", title: "Train smarter", desc: "Take your feedback to CoachIQ. Build a practice plan that directly targets the weaknesses your film revealed." },
            ].map(s => (
              <div key={s.num} className="border border-zinc-800 rounded-xl p-6">
                <p className="mb-3 text-3xl font-black text-zinc-800">{s.num}</p>
                <p className="mb-2 text-base font-bold text-white">{s.title}</p>
                <p className="text-sm text-zinc-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Motto / CTA */}
      <section className="border-t border-zinc-900">
        <div className="mx-auto max-w-4xl px-6 py-24 text-center">
          <h2 className="mb-6 text-4xl font-black tracking-tight sm:text-6xl">
            Your film room.<br />Your coach.<br />
            <span className="text-zinc-600">Your edge.</span>
          </h2>
          <p className="mb-10 text-zinc-500 text-lg">
            No experience required. No equipment needed. No cost — ever.
          </p>
          <button onClick={() => setShowSignUp(true)}
            className="rounded-xl bg-white px-10 py-4 text-base font-bold text-black hover:bg-zinc-100 transition-colors">
            Create free account
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-900 px-6 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <span className="text-sm font-bold text-zinc-700">Reel</span>
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

  const supabase = createClient();

  useEffect(() => {
    // Load local data
    const p = localStorage.getItem("decisioniq-profile");
    if (p) setProfile(JSON.parse(p));
    const r = localStorage.getItem("decisioniq-reviews");
    if (r) setReviews(JSON.parse(r));

    // Check auth session
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setAuthLoading(false);
      if (user) { setShowApp(true); loadUserData(user.id); }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) { setShowApp(true); loadUserData(session.user.id); }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadUserData(userId: string) {
    // Apply signup personalization data if present
    const signupRaw = localStorage.getItem("reel-signup-data");
    if (signupRaw) {
      try {
        const signup = JSON.parse(signupRaw);
        const p: Profile = { name: signup.name || "", sport: signup.sport || "", team: "" };
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
      const p = { name: profileData.name || "", sport: profileData.sport || "", team: profileData.team || "" };
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
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  async function signUpWithGoogle(data: { name: string; sport: string; position: string; level: string; goals: string[] }) {
    // Store signup data so we can save it to their profile after OAuth redirect
    localStorage.setItem("reel-signup-data", JSON.stringify(data));
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
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
    return <LandingPage onSignIn={signInWithGoogle} onSignUp={signUpWithGoogle} onEnterApp={() => setShowApp(true)} />;
  }

  return (
    <main className="min-h-screen bg-black text-white">

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
      />

      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-zinc-900 bg-black/95 backdrop-blur px-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between h-14">

          <div className="flex items-center gap-3">
            <span className="text-2xl font-black tracking-tight">Reel</span>
            <span className="hidden text-[10px] font-semibold uppercase tracking-widest text-zinc-700 sm:block">
              Coaching for every athlete
            </span>
          </div>

          <nav className="flex gap-0.5 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
            {MODULES.map(mod => (
              <button key={mod.id} onClick={() => setActiveModule(mod.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeModule === mod.id ? "bg-white text-black" : "text-zinc-500 hover:text-white"
                }`}
              >
                {mod.label}
              </button>
            ))}
          </nav>

          <button onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-500 hover:text-white hover:border-zinc-600 transition-colors">
            {user
              ? <><span className="h-5 w-5 flex items-center justify-center rounded-full bg-emerald-500 text-white text-[10px] font-bold">{(user.email || "?").charAt(0).toUpperCase()}</span><span className="hidden sm:block">{profile.name ? profile.name.split(" ")[0] : "Account"}</span></>
              : profile.name
              ? <><span className="h-5 w-5 flex items-center justify-center rounded-full bg-white text-black text-[10px] font-bold">{profile.name.charAt(0).toUpperCase()}</span><span className="hidden sm:block">{profile.name.split(" ")[0]}</span></>
              : <span>Settings</span>
            }
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">

        {/* Module header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {activeModule === "decision" ? "DecisionIQ" : "CoachIQ"}
            <span className="ml-2 text-base font-normal text-zinc-600">by Reel</span>
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {activeModule === "decision"
              ? "Upload a clip or full game. Every player gets analyzed — offense, defense, and everything in between."
              : "Your personal coach. Ask anything, or build a custom practice plan tailored to your game."}
          </p>
        </div>

        <HowItWorks activeModule={activeModule} />
        <ProfileCard profile={profile} onSave={saveProfile} />

        {activeModule === "decision" && (
          <>
            <StatsBar reviews={reviews} />
            {reviews.length >= 2 && <GradeTrendChart reviews={reviews} />}
          </>
        )}

        {activeModule === "decision" && <DecisionIQ profile={profile} reviews={reviews} onReviewsChange={setReviews} />}
        {activeModule === "coach"    && <CoachIQ    profile={profile} reviews={reviews} />}
      </div>
    </main>
  );
}
