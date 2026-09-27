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
import ThemeToggle from "./components/ThemeToggle";
import { Segmented } from "./components/ui/segmented";
import { Clapperboard, Brain, ClipboardList, TrendingUp, MessageCircle, Dumbbell, Target, Flame, Film, Library as LibraryIcon, Users, Settings, type LucideIcon } from "lucide-react";
import Landing from "./components/Landing";

const DecisionIQ  = dynamic(() => import("./components/DecisionIQ"), { ssr: false });
const CoachIQ     = dynamic(() => import("./components/CoachIQ"),    { ssr: false });
const FilmLibrary = dynamic(() => import("./components/DecisionIQ").then(m => ({ default: m.FilmLibrary })), { ssr: false });
const Teams       = dynamic(() => import("./components/Teams"),      { ssr: false });
const MySeasonCard = dynamic(() => import("./components/SeasonStats").then(m => ({ default: m.MySeasonCard })), { ssr: false });
const SupportWidget = dynamic(() => import("./components/SupportWidget"), { ssr: false });

function fireBurst(e: React.MouseEvent) {
  import("./components/LandingEffects").then(m => m.fireBurst(e));
}

const DEFAULT_PROFILE: Profile = { name: "", sport: "", team: "" };
const MODULES = [
  { id: "decision", label: "DecisionIQ", sub: "Film analysis",     icon: Film },
  { id: "coach",    label: "CoachIQ",    sub: "Personal coaching", icon: MessageCircle },
  { id: "library",  label: "Library",    sub: "Past reviews",      icon: LibraryIcon },
  { id: "teams",    label: "Teams",      sub: "Season & roster",   icon: Users },
] as const;

// Two-voice page title: the section in ink, what it's for in grey.
function PageTitle({ a, b, right }: { a: string; b: string; right?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <h1 className="font-display text-4xl font-normal leading-[1.05] sm:text-5xl">
        <span className="block">{a}</span>
        <span className="block text-quiet">{b}</span>
      </h1>
      {right}
    </div>
  );
}

const INPUT = "rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40";
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
        className="surface mb-6 flex w-full items-center justify-between px-5 py-4 text-left text-sm text-muted-foreground transition-shadow hover:shadow-lift"
      >
        <span>Set up your athlete profile so Reel can find you on film</span>
        <span className="btn-pill btn-dark !py-2 !text-[13px]">Set up</span>
      </button>
    );
  }

  if (editing) {
    return (
      <div className="surface mb-6 p-5 sm:p-6">
        <p className="mb-4 font-display text-xl">Your profile</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className={INPUT}
            placeholder="Your name" value={draft.name ?? ""} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
          <input className={INPUT}
            placeholder="Primary sport" value={draft.sport ?? ""} onChange={e => setDraft(d => ({ ...d, sport: e.target.value }))} />
          <input className={INPUT}
            placeholder="Team / school" value={draft.team ?? ""} onChange={e => setDraft(d => ({ ...d, team: e.target.value }))} />
          <input className={INPUT}
            placeholder="Jersey number (e.g. 23) tracks your grades over time"
            value={draft.jersey ?? ""} onChange={e => setDraft(d => ({ ...d, jersey: e.target.value }))} />
          <input className={INPUT}
            placeholder="Position (e.g. Point Guard)"
            value={draft.position ?? ""} onChange={e => setDraft(d => ({ ...d, position: e.target.value }))} />
          <input className={INPUT}
            placeholder="Team jersey colors (e.g. White, or 'mixed white + blue')"
            value={draft.teamColor ?? ""} onChange={e => setDraft(d => ({ ...d, teamColor: e.target.value }))} />
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={save} className="btn-pill btn-dark">Save</button>
          <button onClick={() => setEditing(false)} className="btn-pill text-muted-foreground hover:text-foreground">Cancel</button>
        </div>
      </div>
    );
  }

  const avg = averageGrade(reviews.map(r => r.grade).filter(g => g && g !== "N/A"));
  return (
    <div className="mb-8 flex items-center justify-between gap-4 border-b border-border pb-5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card font-mono text-[13px] text-foreground shadow-soft">
          {profile.jersey ? `#${profile.jersey}` : profile.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[15px] text-foreground">{profile.name}</p>
          <p className="truncate text-[13px] text-muted-foreground">
            {[profile.sport, profile.team].filter(Boolean).join(" · ") || "Athlete"}
            {reviews.length > 0 && <span className="hidden sm:inline"> · {reviews.length} {reviews.length === 1 ? "review" : "reviews"}{avg !== "N/A" && <> · avg <span className="text-foreground">{avg}</span></>}</span>}
          </p>
        </div>
      </div>
      <button onClick={() => { setDraft(profile); setEditing(true); }} className="btn-pill btn-light shrink-0 !py-2 !text-[13px]">
        Edit profile
      </button>
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
    <div className="surface grid grid-cols-2 gap-y-6 p-5 sm:grid-cols-4 sm:p-6">
      {stats.map(({ label, value, grade, fire }) => (
        <div key={label}>
          {grade
            ? <span className={`inline-flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-lg ${gradeClass(value, "bg")} ${gradeClass(value, "text")}`}>{value}</span>
            : <p className="flex items-center gap-1.5 font-display text-4xl capitalize leading-none text-foreground">{value}{fire ? <Flame className="h-5 w-5 text-court" /> : null}</p>
          }
          <p className="mt-2 text-[12px] text-muted-foreground">{label}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Grade Trend Chart ────────────────────────────────────────────────────────

function GradeTrendChart({ reviews }: { reviews: Review[] }) {
  const recent = [...reviews].reverse().slice(-20);
  if (recent.length < 2) return null;

  const W = 720, H = 180, PL = 28, PR = 12, PT = 12, PB = 24;
  const iW = W - PL - PR, iH = H - PT - PB;
  const xp = (i: number) => PL + (i / (recent.length - 1)) * iW;
  const yp = (v: number) => PT + iH - ((v - 1) / 12) * iH;
  const vals  = recent.map(r => GRADE_VALUE[r.grade] ?? 0);
  const first = vals[0] ?? 0, last = vals[vals.length - 1] ?? 0;
  const color = last > first ? "#10b981" : last < first ? "var(--court)" : "var(--muted-foreground)";
  const pts   = recent.map((r, i) => ({ x: xp(i), y: yp(GRADE_VALUE[r.grade] ?? 0), r }));
  const poly  = pts.map(p => `${p.x},${p.y}`).join(" ");

  return (
    <section className="surface p-5 sm:p-6">
      <h2 className="font-display text-xl text-foreground">Grade trend</h2>
      <p className="mb-4 mt-1 text-[13px] text-muted-foreground">Your last {recent.length} reviews, oldest to newest.</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
        {[{ v: 13, l: "A+" }, { v: 9, l: "B" }, { v: 6, l: "C" }, { v: 1, l: "F" }].map(({ v, l }) => (
          <g key={v}>
            <line x1={PL} y1={yp(v)} x2={W - PR} y2={yp(v)} stroke="var(--border)" strokeWidth="1" />
            <text x={PL - 5} y={yp(v) + 4} textAnchor="end" fill="var(--muted-foreground)" fontSize="9">{l}</text>
          </g>
        ))}
        <polyline points={poly} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3.5" fill={color} stroke="var(--card)" strokeWidth="2" />)}
        {[0, Math.floor((recent.length - 1) / 2), recent.length - 1].map(i => (
          <text key={i} x={xp(i)} y={H - 4} textAnchor="middle" fill="var(--muted-foreground)" fontSize="9">
            {new Date(recent[i].timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </text>
        ))}
      </svg>
    </section>
  );
}

// ─── How It Works ─────────────────────────────────────────────────────────────

const HOW_STEPS: Record<"decision" | "coach", { icon: LucideIcon; title: string; desc: string }[]> = {
  decision: [
    { icon: Clapperboard, title: "Upload your footage",      desc: "Short clip or full game. Sport, teams, and situation are detected automatically." },
    { icon: Brain, title: "Every player is reviewed", desc: "Everyone on screen gets a grade, a breakdown, and what they should've done instead." },
    { icon: ClipboardList, title: "See the full picture",     desc: "What happened, the better option, and one thing to work on. Games get full reports." },
    { icon: TrendingUp, title: "Track your progress",      desc: "Every review is saved. Watch your grade trend climb over time." },
  ],
  coach: [
    { icon: MessageCircle, title: "Ask your coach anything",  desc: "Technique, strategy, mindset. Answers specific to your sport and your film." },
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
    <div className="mb-8">
      <button onClick={toggle}
        className="flex w-full items-center justify-between gap-3 py-2 text-left">
        <p className="text-[15px] text-foreground">
          <span className="text-muted-foreground">How it works · </span>
          {activeModule === "decision" ? "From raw footage to real feedback" : "From questions to a real plan"}
        </p>
        <span className="btn-pill btn-light !px-3.5 !py-1.5 !text-xs">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="space-y-5 pt-3">
          <div className="grid border-t border-border sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <div key={s.title} className="border-b border-border py-5 sm:pr-6 lg:border-b-0">
                <div className="mb-3 flex items-center gap-2 text-muted-foreground">
                  <span className="font-mono text-[11px]">0{i + 1}</span>
                  <s.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                </div>
                <p className="mb-1 text-[15px] text-foreground">{s.title}</p>
                <p className="text-[13px] leading-relaxed text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>

          {activeModule === "decision" && (
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              <span className="text-foreground">DecisionIQ</span> is your film room.{" "}
              <span className="text-foreground">CoachIQ</span> is your coach on the sideline. Analyze a clip, then build a plan around what you found.
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
      <div className={`fixed top-0 right-0 z-50 h-full w-full max-w-sm bg-card border-l border-border transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex h-full flex-col overflow-y-auto">

          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <p className="text-sm font-semibold text-foreground">Settings</p>
            <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Close</button>
          </div>

          <div className="flex-1 space-y-6 p-5">

            {/* Profile */}
            <div>
              <p className="mb-3 text-[12px] text-muted-foreground">Profile</p>
              <div className="space-y-2">
                {(["name", "sport", "team", "jersey"] as const).map(k => (
                  <input key={k}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 transition-shadow"
                    placeholder={k === "name" ? "Your name" : k === "sport" ? "Primary sport" : k === "team" ? "Team / school" : "Jersey number (e.g. 23)"}
                    value={draft[k] ?? ""}
                    onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))}
                  />
                ))}
                <button onClick={save}
                  className="btn-pill btn-dark w-full py-2.5 text-sm">
                  {saved ? "Saved" : "Save Profile"}
                </button>
              </div>
            </div>

            {/* Stats */}
            <div>
              <p className="mb-3 text-[12px] text-muted-foreground">Your Stats</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Total Reviews", value: reviews.length },
                  { label: "Clips", value: reviews.filter(r => r.mode === "clip").length },
                  { label: "Games", value: reviews.filter(r => r.mode === "game").length },
                  { label: "Sports", value: new Set(reviews.map(r => r.sport.toLowerCase())).size },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg border border-border px-3 py-2.5">
                    <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
                    <p className="text-lg font-bold text-foreground">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Data */}
            <div>
              <p className="mb-3 text-[12px] text-muted-foreground">Data</p>
              <div className="space-y-2">
                <button onClick={exportHistory} disabled={reviews.length === 0}
                  className="w-full rounded-lg border border-border py-2.5 text-sm text-foreground hover:bg-muted disabled:opacity-30 transition-colors">
                  Export History
                </button>
                {!confirmClear
                  ? <button onClick={() => setConfirmClear(true)} disabled={reviews.length === 0}
                      className="w-full rounded-lg border border-border py-2.5 text-sm text-muted-foreground hover:text-red-400 hover:border-red-900 disabled:opacity-30 transition-colors">
                      Clear All History
                    </button>
                  : <div className="rounded-lg border border-red-500/25 p-3 space-y-2">
                      <p className="text-xs text-muted-foreground">Delete all {reviews.length} reviews? This can't be undone.</p>
                      <div className="flex gap-2">
                        <button onClick={() => { onClearHistory(); setConfirmClear(false); onClose(); }}
                          className="flex-1 rounded-lg bg-red-600 py-2 text-xs font-semibold text-foreground hover:bg-red-700 transition-colors">
                          Delete All
                        </button>
                        <button onClick={() => setConfirmClear(false)}
                          className="flex-1 rounded-lg border border-border py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                }
              </div>
            </div>

            {/* Account */}
            <div>
              <p className="mb-3 text-[12px] text-muted-foreground">Account</p>
              {user ? (
                <div className="space-y-2">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground mb-0.5">Signed in as</p>
                    <p className="text-sm font-semibold text-foreground truncate">{user.email}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Plan</p>
                      <p className="text-sm font-semibold text-foreground">{isPro ? "Reel Pro" : "Free"}</p>
                    </div>
                    {isPro ? (
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch("/api/stripe/portal", { method: "POST" });
                            const data = await res.json();
                            if (data.url) window.location.href = data.url;
                          } catch { /* portal unavailable; support email remains the fallback */ }
                        }}
                        className="btn-pill btn-light px-3 py-2 text-xs">
                        Manage subscription
                      </button>
                    ) : (
                      onUpgrade && (
                        <button onClick={onUpgrade}
                          className="btn-pill btn-dark px-3 py-2 text-xs">
                          Upgrade
                        </button>
                      )
                    )}
                  </div>
                  <button onClick={onSignOut}
                    className="w-full rounded-lg border border-border py-2.5 text-sm text-muted-foreground hover:text-red-400 hover:border-red-900 transition-colors">
                    Sign Out
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Sign in to save your history across all devices.</p>
                  <button onClick={onSignIn}
                    className="btn-pill btn-dark w-full py-2.5 text-sm">
                    Sign in with Google
                  </button>
                </div>
              )}
            </div>


            {/* About */}
            <div>
              <p className="mb-3 text-[12px] text-muted-foreground">About</p>
              <div className="rounded-lg border border-border p-4 space-y-1">
                <Logo size="sm" className="mb-1" />
                <p className="text-xs text-muted-foreground">Coaching for every athlete. Any sport, any level.</p>
                <p className="text-xs text-muted-foreground mt-2">Built with DecisionIQ + CoachIQ</p>
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
      body: "This is your personal film room and coaching hub. Everything you need to analyze your game and get better, all in one place.",
      cta: "Show me how →",
    },
    {
      eyebrow: "DecisionIQ",
      title: "Upload a clip. Get real feedback.",
      body: "Drop in any video, a 10-second clip or a full game. DecisionIQ grades every player on screen, breaks down each decision, and tells you exactly what to work on.",
      cta: "Got it →",
    },
    {
      eyebrow: "You're ready",
      title: "Upload your first clip.",
      body: "It takes about 30 seconds. Pick something recent: a play you were proud of, or one you want to understand better.",
      cta: "Upload a clip",
    },
  ];

  const s = slides[step];
  const isLast = step === slides.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm backdrop-blur-sm p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-border bg-card p-8 shadow-2xl">
        {/* Progress */}
        <div className="mb-8 flex gap-1.5">
          {slides.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= step ? "bg-primary" : "bg-accent"}`} />
          ))}
        </div>

        <p className="mb-2 text-[12px] text-muted-foreground">{s.eyebrow}</p>
        <h2 className="mb-3 text-2xl font-semibold tracking-tight text-foreground">{s.title}</h2>
        <p className="mb-8 text-sm text-muted-foreground leading-relaxed">{s.body}</p>

        <div className="flex items-center gap-3">
          <button
            onClick={() => isLast ? onDone() : setStep(s => s + 1)}
            className="flex-1 rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {s.cta}
          </button>
          {!isLast && (
            <button onClick={onDone} className="text-xs text-muted-foreground hover:text-muted-foreground transition-colors">
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
          className="w-full rounded-xl border border-input bg-muted px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 text-base"
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
              className={`rounded-xl border px-4 py-3 text-sm font-medium text-left transition-colors ${sport === s ? "border-white bg-primary text-primary-foreground" : "border-border text-foreground hover:border-ring"}`}>
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
          className="w-full rounded-xl border border-input bg-muted px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 text-base"
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
      sub: "Your jersey number and team colors let Reel find YOU in the footage and track your grades, not just the team's.",
      content: (
        <div className="flex flex-col gap-2">
          <input
            autoFocus
            className="w-full rounded-xl border border-input bg-muted px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 text-base"
            placeholder="Jersey number (e.g. 23)"
            value={jersey}
            onChange={e => setJersey(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
            inputMode="numeric"
          />
          <input
            className="w-full rounded-xl border border-input bg-muted px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 text-base"
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
              className={`rounded-xl border px-4 py-3 text-sm font-medium text-left transition-colors ${level === l ? "border-white bg-primary text-primary-foreground" : "border-border text-foreground hover:border-ring"}`}>
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
                className={`rounded-xl border px-4 py-3 text-sm font-medium text-left transition-colors flex items-center gap-3 ${on ? "border-white bg-primary text-primary-foreground" : "border-border text-foreground hover:border-ring"}`}>
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${on ? "border-black bg-background text-foreground" : "border-ring"}`}>{on ? "✓" : ""}</span>
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm backdrop-blur-sm p-0 sm:p-4">
      <div className="relative w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-2xl max-h-[90dvh] overflow-y-auto">
        {/* Close */}
        <button onClick={onClose} className="absolute right-5 top-5 text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">✕</button>

        {/* Progress dots */}
        <div className="mb-8 flex gap-1.5">
          {steps.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-accent"}`} />
          ))}
        </div>

        {/* Content */}
        <h2 className="mb-1 text-xl font-semibold tracking-tight text-foreground">{current.title}</h2>
        <p className="mb-6 text-sm text-muted-foreground">{current.sub}</p>
        {current.content}

        {/* Actions */}
        <div className="mt-6 flex gap-3">
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)}
              className="rounded-xl border border-border px-5 py-3 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
              Back
            </button>
          )}
          <button
            onClick={() => isLast ? onContinue({ name, sport, position, level, goals, jersey, teamColor }) : setStep(s => s + 1)}
            disabled={!current.canNext}
            className="flex-1 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-30 hover:bg-primary/90 transition-colors">
            {isLast ? "Create my account →" : step === 2 ? "Skip" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Animation helpers ────────────────────────────────────────────────────────

// ─── Landing Page ─────────────────────────────────────────────────────────────

function LandingPage({ onSignIn, onSignUp, onEnterApp, signingIn, authError }: { onSignIn: () => void; onSignUp: (data: { name: string; sport: string; position: string; level: string; goals: string[]; jersey: string; teamColor: string }) => void; onEnterApp: () => void; signingIn?: boolean; authError?: string }) {
  const [showSignUp, setShowSignUp] = useState(false);
  return (
    <>
      <AnimatePresence>
        {showSignUp && (
          <SignUpModal
            onClose={() => setShowSignUp(false)}
            onContinue={(data) => { setShowSignUp(false); onSignUp(data); }}
          />
        )}
      </AnimatePresence>
      <Landing onStart={() => setShowSignUp(true)} onSignIn={onSignIn} onEnterApp={onEnterApp} signingIn={signingIn} authError={authError} />
    </>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export default function Reel() {
  const [activeModule,  setActiveModule]  = useState<ModuleId>("decision");
  const [profile,       setProfile]       = useState<Profile>(DEFAULT_PROFILE);
  const [reviews,       setReviews]       = useState<Review[]>([]);
  const [libraryView,   setLibraryView]   = useState<"film" | "stats">("film");
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

  // "Check my drill" from a report jumps to CoachIQ (which opens its Drill
  // Check tab and picks up the prefilled drill from localStorage).
  useEffect(() => {
    const open = () => setActiveModule("coach");
    window.addEventListener("reel-open-drill-check", open);
    return () => window.removeEventListener("reel-open-drill-check", open);
  }, []);

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
          // Landing "Go Pro" sets this flag before sign-up: carry the intent
          // through the OAuth round-trip straight into the upgrade modal.
          const wantsUpgrade = localStorage.getItem("reel-upgrade-intent");
          if (wantsUpgrade) localStorage.removeItem("reel-upgrade-intent");
          else if (!localStorage.getItem("reel-onboarded")) setShowOnboarding(true);
          // Load pro status first — someone who is already Pro (or an owner)
          // should never see the upgrade pitch, even if they clicked Go Pro.
          fetch(`/api/usage`)
            .then(r => r.json())
            .then(d => {
              const pro = d.is_pro ?? false;
              setIsPro(pro);
              if (wantsUpgrade && !pro) setShowUpgrade(true);
            })
            .catch(() => { if (wantsUpgrade) setShowUpgrade(true); });
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
      // jersey/position/teamColor may not exist as columns yet — fall back to
      // this browser's copy rather than wiping them on every login.
      let local: Partial<Profile> = {};
      try { local = JSON.parse(localStorage.getItem("decisioniq-profile") || "{}"); } catch { /* ignore */ }
      const p = {
        name: profileData.name || "", sport: profileData.sport || "", team: profileData.team || "",
        jersey: profileData.jersey || local.jersey || "", position: profileData.position || local.position || "",
        teamColor: profileData.teamColor || local.teamColor || "",
      };
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
        gameDate: r.game_date, location: r.location, thumbnailUrl: r.thumbnail_url,
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
      const { error } = await supabase.from("profiles").upsert({ id: user.id, ...p });
      // Older databases lack the jersey/position/teamColor columns; still save
      // the core fields instead of losing the whole edit.
      if (error) await supabase.from("profiles").upsert({ id: user.id, name: p.name, sport: p.sport, team: p.team });
    }
  }

  // Tag an older game with the jersey colour the user wore, so the season
  // ledger knows which side of its box score was theirs.
  async function setGameColor(review: Review, color: string) {
    const { saveReviewTeamColor } = await import("./components/SeasonStats");
    if (!await saveReviewTeamColor(user?.id, review, color)) return;
    setReviews(prev => prev.map(r => r.id === review.id ? { ...r, teamColor: color } : r));
  }

  function clearHistory() {
    setReviews([]);
    localStorage.removeItem("decisioniq-reviews");
    if (user) supabase.from("reviews").delete().eq("user_id", user.id);
  }

  // Show loading spinner briefly
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm animate-pulse">Loading…</p>
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
    <main className="min-h-screen bg-background text-foreground">

      {showOnboarding && (
        <OnboardingOverlay name={profile.name} onDone={dismissOnboarding} />
      )}

      {showUpgrade && (
        <UpgradeModal user={user} onClose={() => setShowUpgrade(false)} />
      )}

      {/* Upgrade success toast */}
      {upgradeSuccess && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-foreground px-5 py-3 text-background shadow-lift">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <p className="text-sm">Welcome to Reel Pro. More film, more feedback.</p>
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

      {/* Header: wordmark left, the four sections as a floating pill in the
          middle, theme + account right. */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <Logo size="sm" />
            {isPro && <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] font-medium text-background">Pro</span>}
          </div>

          <nav className="hidden items-center gap-1 rounded-full bg-card p-1 shadow-soft md:flex">
            {MODULES.map(mod => {
              const active = activeModule === mod.id;
              const Icon = mod.icon;
              return (
                <button key={mod.id} onClick={() => setActiveModule(mod.id)} data-module={mod.id}
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-all ${active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />{mod.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button onClick={() => setSettingsOpen(true)} aria-label="Settings"
              className="flex h-9 items-center gap-2 rounded-full bg-card px-1.5 pr-3 text-muted-foreground shadow-soft transition-colors hover:text-foreground">
              {user?.user_metadata?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.user_metadata.avatar_url} alt="Your avatar" className="h-6 w-6 rounded-full object-cover" referrerPolicy="no-referrer" />
              ) : user ? (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-medium text-background">
                  {(user.email || "?").charAt(0).toUpperCase()}
                </span>
              ) : <span className="w-1.5" />}
              <Settings className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Phones: the same pill nav, scrollable */}
        <nav className="flex gap-1 overflow-x-auto px-4 pb-3 md:hidden">
          {MODULES.map(mod => {
            const Icon = mod.icon;
            return (
              <button key={mod.id} onClick={() => setActiveModule(mod.id)} data-module={mod.id}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] transition-colors ${activeModule === mod.id ? "bg-foreground text-background" : "bg-card text-muted-foreground shadow-soft"}`}>
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />{mod.label}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <motion.div key={activeModule} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} className="min-w-0 pb-24 pt-8 sm:pt-12">

        {activeModule === "library" ? (
          <>
            <PageTitle a="Library." b={libraryView === "film" ? "Every game and clip, by team." : "Your season, in numbers."}
              right={<Segmented value={libraryView} onChange={setLibraryView}
                options={[{ value: "film", label: "Film", count: reviews.length }, { value: "stats", label: "Stats" }]} />} />
            {libraryView === "film" ? (
              <FilmLibrary reviews={reviews} onReviewsChange={setReviews} userId={user?.id} />
            ) : reviews.length === 0 ? (
              <p className="surface py-12 text-center text-sm text-muted-foreground">Analyze a game or clip and your stats will show up here.</p>
            ) : (
              <div className="space-y-5">
                <StatsBar reviews={reviews} />
                <MySeasonCard reviews={reviews} jersey={profile.jersey} onSetColor={setGameColor} />
                {reviews.length >= 2 && <GradeTrendChart reviews={reviews} />}
              </div>
            )}
          </>
        ) : activeModule === "teams" ? (
          <>
            <PageTitle a="Teams." b="Your season, roster and record." />
            <Teams userId={user?.id} sport={profile.sport} reviews={reviews} onReviewsChange={setReviews} isPro={isPro} onShowUpgrade={() => setShowUpgrade(true)} />
          </>
        ) : (
          <>
            {activeModule === "decision"
              ? <PageTitle a="Film analysis." b="Paste a game, get it graded." />
              : <PageTitle a="Your coach." b="Ask anything, build a plan." />}

            <HowItWorks activeModule={activeModule as "decision" | "coach"} />
            <ProfileCard profile={profile} onSave={saveProfile} reviews={reviews} />

            {activeModule === "decision" && <DecisionIQ profile={profile} reviews={reviews} onReviewsChange={setReviews} userId={user?.id} isPro={isPro} onShowUpgrade={() => setShowUpgrade(true)} />}
            {activeModule === "coach"    && <CoachIQ    profile={profile} reviews={reviews} userId={user?.id} onShowUpgrade={() => setShowUpgrade(true)} />}
          </>
        )}
        </motion.div>
      </div>

      {/* Help / support assistant — floating, available across the app */}
      <SupportWidget />
    </main>
  );
}
