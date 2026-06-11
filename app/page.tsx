"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { Profile, Review } from "./lib/types";
import { averageGrade, gradeClass, formatDate, GRADE_VALUE } from "./lib/shared";

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

// ─── Shell ────────────────────────────────────────────────────────────────────

export default function VoiceLift() {
  const [activeModule, setActiveModule] = useState<ModuleId>("decision");
  const [profile,      setProfile]      = useState<Profile>(DEFAULT_PROFILE);
  const [reviews,      setReviews]      = useState<Review[]>([]);

  useEffect(() => {
    const p = localStorage.getItem("decisioniq-profile");
    if (p) setProfile(JSON.parse(p));
    const r = localStorage.getItem("decisioniq-reviews");
    if (r) setReviews(JSON.parse(r));
  }, []);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "decisioniq-reviews" && e.newValue) setReviews(JSON.parse(e.newValue));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function saveProfile(p: Profile) {
    setProfile(p);
    localStorage.setItem("decisioniq-profile", JSON.stringify(p));
  }

  return (
    <main className="min-h-screen bg-black text-white">

      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-zinc-900 bg-black/95 backdrop-blur px-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between h-14">

          <div className="flex items-center gap-3">
            <span className="text-base font-bold tracking-tight">VoiceLift</span>
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

          {profile.name
            ? <div className="h-7 w-7 shrink-0 flex items-center justify-center rounded-full bg-white text-black text-xs font-bold">
                {profile.name.charAt(0).toUpperCase()}
              </div>
            : <div className="w-7" />
          }
        </div>
      </header>

      {/* Body */}
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">

        {/* Module header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {activeModule === "decision" ? "DecisionIQ" : "CoachIQ"}
            <span className="ml-2 text-base font-normal text-zinc-600">by VoiceLift</span>
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
