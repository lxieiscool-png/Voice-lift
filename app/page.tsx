"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { Profile, Review } from "./lib/types";
import { sportIcon, averageGrade, gradeClass, formatDate, GRADE_VALUE, VALUE_GRADE } from "./lib/shared";

// Lazy-load heavy modules
const DecisionIQ = dynamic(() => import("./components/DecisionIQ"), { ssr: false });
const CoachIQ = dynamic(() => import("./components/CoachIQ"), { ssr: false });

const DEFAULT_PROFILE: Profile = { name: "", sport: "", team: "" };

const MODULES = [
  { id: "decision", label: "DecisionIQ", icon: "🎬", tagline: "Film analysis" },
  { id: "coach",    label: "CoachIQ",    icon: "🧠", tagline: "Personal coaching" },
] as const;

type ModuleId = typeof MODULES[number]["id"];

// ─── Profile Card ─────────────────────────────────────────────────────────────

function ProfileCard({ profile, onSave }: { profile: Profile; onSave: (p: Profile) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);

  function save() { onSave(draft); setEditing(false); }

  if (!profile.name && !editing) {
    return (
      <button
        onClick={() => { setDraft({ name: "", sport: "", team: "" }); setEditing(true); }}
        className="mb-6 w-full rounded-2xl border border-dashed border-zinc-700 py-3 text-sm text-zinc-500 hover:border-white hover:text-white transition-colors"
      >
        + Set up your athlete profile
      </button>
    );
  }

  if (editing) {
    return (
      <div className="mb-6 rounded-2xl border border-zinc-700 bg-zinc-900 p-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Your Profile</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { placeholder: "Your name", key: "name" as const },
            { placeholder: "Primary sport", key: "sport" as const },
            { placeholder: "Team / school", key: "team" as const },
          ].map(({ placeholder, key }) => (
            <input key={key}
              className="rounded-xl border border-zinc-700 bg-black px-4 py-2.5 text-sm placeholder-zinc-500 focus:outline-none focus:border-white"
              placeholder={placeholder} value={draft[key]}
              onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
            />
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={save} className="rounded-xl bg-white px-5 py-2 text-sm font-bold text-black hover:bg-gray-100">Save</button>
          <button onClick={() => setEditing(false)} className="rounded-xl border border-zinc-700 px-5 py-2 text-sm text-zinc-400 hover:text-white">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-900 px-5 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black text-lg font-black">
          {profile.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="font-bold text-white leading-tight">{profile.name}</p>
          <p className="text-xs text-zinc-400">
            {[profile.sport && `${sportIcon(profile.sport)} ${profile.sport}`, profile.team].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <button onClick={() => { setDraft(profile); setEditing(true); }}
        className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-white hover:border-white transition-colors">
        Edit
      </button>
    </div>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ reviews }: { reviews: Review[] }) {
  if (reviews.length === 0) return null;
  const allGrades = reviews.map(r => r.grade).filter(g => g && g !== "N/A");
  const avg = averageGrade(allGrades);
  const sportCounts: Record<string, number> = {};
  for (const r of reviews) {
    const s = (r.sport || "Unknown").toLowerCase();
    sportCounts[s] = (sportCounts[s] ?? 0) + 1;
  }
  const topSport = Object.entries(sportCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        { label: "Clips", value: String(reviews.filter(r => r.mode === "clip").length) },
        { label: "Games", value: String(reviews.filter(r => r.mode === "game").length) },
        { label: "Avg Grade", value: avg, colored: true },
        { label: "Top Sport", value: `${sportIcon(topSport)} ${topSport}` },
      ].map(({ label, value, colored }) => (
        <div key={label} className="rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-center">
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
          {colored
            ? <span className={`inline-block rounded-lg px-3 py-0.5 text-xl font-black ${gradeClass(value, "bg")} ${gradeClass(value, "text")}`}>{value}</span>
            : <p className="text-2xl font-black text-white">{value}</p>}
        </div>
      ))}
    </div>
  );
}

// ─── Grade Trend Chart ────────────────────────────────────────────────────────

function GradeTrendChart({ reviews }: { reviews: Review[] }) {
  const recent = [...reviews].reverse().slice(-20);
  if (recent.length < 2) return null;
  const W = 600, H = 140, PAD = { top: 16, right: 16, bottom: 28, left: 32 };
  const innerW = W - PAD.left - PAD.right, innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (recent.length - 1)) * innerW;
  const y = (v: number) => PAD.top + innerH - ((v - 1) / 12) * innerH;
  const values = recent.map(r => GRADE_VALUE[r.grade] ?? 0);
  const points = recent.map((r, i) => ({ x: x(i), y: y(GRADE_VALUE[r.grade] ?? 0), r }));
  const polyline = points.map(p => `${p.x},${p.y}`).join(" ");
  const first = values[0] ?? 0, last = values[values.length - 1] ?? 0;
  const trendColor = last > first ? "#10b981" : last < first ? "#f87171" : "#71717a";

  return (
    <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">📈 Grade Trend</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 140 }}>
        {[{ v: 13, l: "A+" }, { v: 9, l: "B" }, { v: 6, l: "C" }, { v: 3, l: "D" }, { v: 1, l: "F" }].map(({ v, l }) => (
          <g key={v}>
            <line x1={PAD.left} y1={y(v)} x2={W - PAD.right} y2={y(v)} stroke="#27272a" strokeWidth="1" />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fill="#71717a" fontSize="10">{l}</text>
          </g>
        ))}
        <polyline points={polyline} fill="none" stroke={trendColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="4" fill={trendColor} stroke="#000" strokeWidth="1.5" />
        ))}
        {[0, Math.floor((recent.length - 1) / 2), recent.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 4} textAnchor="middle" fill="#52525b" fontSize="9">
            {new Date(recent[i].timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ─── How It Works ─────────────────────────────────────────────────────────────

function HowItWorks({ activeModule }: { activeModule: ModuleId }) {
  const [open, setOpen] = useState(true);
  const steps = activeModule === "decision"
    ? [
        {
          icon: "📹",
          title: "Upload your footage",
          desc: "Drop in a short clip or a full game recording. DecisionIQ figures out the sport, the teams, and the situation automatically — no setup needed.",
        },
        {
          icon: "🔍",
          title: "Every player gets reviewed",
          desc: "It doesn't just look at the ball-handler. Every player on the frame — offense and defense — gets their own grade, breakdown, and feedback based on what they did and what they could have done instead.",
        },
        {
          icon: "📊",
          title: "See the full picture",
          desc: "Each decision card shows what happened, whether it was the right read, the better option, and one thing to work on. For full games, you also get period breakdowns, foul patterns, and player-level stats.",
        },
        {
          icon: "📈",
          title: "Track your progress",
          desc: "Every review is saved to your history. Over time you can see your grade trend, what sports you're reviewing most, and whether your decision-making is improving.",
        },
      ]
    : [
        {
          icon: "💬",
          title: "Ask your coach anything",
          desc: "Have a question about technique, strategy, positioning, or mindset? Type it in. CoachIQ knows your sport, your profile, and the patterns your film analysis flagged — so the answers are specific to you.",
        },
        {
          icon: "📋",
          title: "Get a real practice plan",
          desc: "Tell CoachIQ your position, experience level, how many days a week you can train, and what you want to improve. It builds a full week of sessions — each with specific drills, reps, and explanations of why each drill helps.",
        },
        {
          icon: "🔗",
          title: "It connects to your film",
          desc: "Patterns found in your DecisionIQ reviews automatically feed into CoachIQ. Your practice plan targets the exact weaknesses your film identified — not just generic advice.",
        },
      ];

  return (
    <div className="mb-8 rounded-3xl border border-zinc-800 bg-zinc-900 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-6 py-4 text-left"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-0.5">How it works</p>
          <h2 className="text-lg font-bold text-white">
            {activeModule === "decision" ? "From raw footage to real feedback" : "From questions to a real plan"}
          </h2>
        </div>
        <span className="text-zinc-500 text-sm">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-zinc-800 p-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <div key={i} className="rounded-2xl border border-zinc-800 bg-black p-4">
                <div className="mb-3 flex items-center gap-3">
                  <span className="text-2xl">{step.icon}</span>
                  <span className="text-xs font-bold text-zinc-500">Step {i + 1}</span>
                </div>
                <p className="mb-1 font-bold text-white text-sm">{step.title}</p>
                <p className="text-xs text-zinc-400 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>

          {activeModule === "decision" && (
            <div className="rounded-2xl border border-zinc-700 bg-zinc-800 px-5 py-4">
              <p className="text-sm text-zinc-300 leading-relaxed">
                <span className="font-bold text-white">DecisionIQ</span> is your film room.{" "}
                <span className="font-bold text-white">CoachIQ</span> is your coach on the sideline. Use both together — analyze a clip, then ask CoachIQ to build a plan around what you found.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Shell ───────────────────────────────────────────────────────────────

export default function VoiceLift() {
  const [activeModule, setActiveModule] = useState<ModuleId>("decision");
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [reviews, setReviews] = useState<Review[]>([]);

  useEffect(() => {
    const p = localStorage.getItem("decisioniq-profile");
    if (p) setProfile(JSON.parse(p));
    const r = localStorage.getItem("decisioniq-reviews");
    if (r) setReviews(JSON.parse(r));
  }, []);

  // Listen for review updates from DecisionIQ
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "decisioniq-reviews" && e.newValue) {
        setReviews(JSON.parse(e.newValue));
      }
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

      {/* ── Top nav ── */}
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-black/90 backdrop-blur px-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between py-3">
          {/* Brand */}
          <div>
            <span className="text-xl font-black tracking-tight">VoiceLift</span>
            <span className="ml-2 hidden text-xs text-zinc-500 sm:inline">Coaching for every athlete</span>
          </div>

          {/* Module tabs */}
          <nav className="flex gap-1 rounded-xl border border-zinc-800 bg-zinc-900 p-1">
            {MODULES.map((mod) => (
              <button
                key={mod.id}
                onClick={() => setActiveModule(mod.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                  activeModule === mod.id ? "bg-white text-black" : "text-zinc-400 hover:text-white"
                }`}
              >
                <span>{mod.icon}</span>
                <span className="hidden sm:inline">{mod.label}</span>
              </button>
            ))}
          </nav>

          {/* Profile avatar */}
          {profile.name && (
            <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded-full bg-white text-black text-sm font-black">
              {profile.name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      </header>

      {/* ── Page body ── */}
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">

        {/* Module header */}
        <div className="mb-6">
          {activeModule === "decision" && (
            <div>
              <h1 className="text-3xl font-black sm:text-4xl">DecisionIQ <span className="text-zinc-500 font-normal text-xl sm:text-2xl">by VoiceLift</span></h1>
              <p className="mt-1 text-zinc-400">Upload a clip or full game. Every player gets analyzed — offense, defense, and everything in between.</p>
            </div>
          )}
          {activeModule === "coach" && (
            <div>
              <h1 className="text-3xl font-black sm:text-4xl">CoachIQ <span className="text-zinc-500 font-normal text-xl sm:text-2xl">by VoiceLift</span></h1>
              <p className="mt-1 text-zinc-400">Your personal coach. Ask anything, or build a custom practice plan tailored to your game.</p>
            </div>
          )}
        </div>

        {/* How it works */}
        <HowItWorks activeModule={activeModule} />

        {/* Profile */}
        <ProfileCard profile={profile} onSave={saveProfile} />

        {/* Stats + chart — only on DecisionIQ tab */}
        {activeModule === "decision" && (
          <>
            <StatsBar reviews={reviews} />
            {reviews.length >= 2 && <GradeTrendChart reviews={reviews} />}
          </>
        )}

        {/* Active module */}
        {activeModule === "decision" && (
          <DecisionIQ
            profile={profile}
            reviews={reviews}
            onReviewsChange={setReviews}
          />
        )}
        {activeModule === "coach" && (
          <CoachIQ profile={profile} reviews={reviews} />
        )}
      </div>
    </main>
  );
}
