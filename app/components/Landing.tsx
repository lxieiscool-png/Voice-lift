"use client";

import { useEffect, useRef, useState } from "react";
import {
  motion, useScroll, useTransform, useReducedMotion, useSpring, useMotionValueEvent,
  type MotionValue,
} from "framer-motion";
import { ArrowRight, Menu, X, Play } from "lucide-react";
import Logo from "./Logo";
import HeroBoard from "./HeroBoard";
import { FilmStrip, ChalkboardPlay, SeasonScoreboard, GiantGrade } from "./LandingSections";

// The public landing page. Light, quiet and type-led (after spacefs.com):
// one idea per screen, and the product itself is the illustration — a Reel
// game report that assembles itself as you scroll.

type LandingProps = {
  onStart: () => void;
  onSignIn: () => void;
  onEnterApp: () => void;
  signingIn?: boolean;
  authError?: string;
};

const EASE = [0.22, 1, 0.36, 1] as const;

// Fade-and-rise the first time something scrolls into view.
function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className}
      initial={reduce ? false : { opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.8, delay, ease: EASE }}>
      {children}
    </motion.div>
  );
}

// Two-voice heading: the statement in ink, the payoff in grey.
function Heading({ a, b, className = "", as: Tag = "h2" }: { a: string; b: string; className?: string; as?: "h1" | "h2" }) {
  return (
    <Tag className={`font-display font-normal leading-[1.04] ${className}`}>
      <span className="block">{a}</span>
      <span className="block text-quiet">{b}</span>
    </Tag>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────

function Header({ onStart, onSignIn, signingIn }: Pick<LandingProps, "onStart" | "onSignIn" | "signingIn">) {
  const [open, setOpen] = useState(false);
  const links = [["Film", "#film"], ["Coach", "#coach"], ["Pricing", "#pricing"]];
  // Frost the bar once the page moves, so copy doesn't scroll under bare pills.
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", v => setScrolled(v > 12));
  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${scrolled ? "bg-background/75 backdrop-blur-md" : ""}`}>
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="#top" aria-label="Reel home"><Logo size="md" /></a>

        <nav className="hidden items-center gap-1 rounded-full bg-card/85 p-1 shadow-soft backdrop-blur md:flex">
          {links.map(([label, href]) => (
            <a key={href} href={href}
              className="rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              {label}
            </a>
          ))}
        </nav>
        <button onClick={() => setOpen(o => !o)} aria-label="Menu"
          className="btn-pill btn-light !px-4 md:hidden">
          {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />} Menu
        </button>

        <div className="flex items-center gap-2">
          <button onClick={onSignIn} disabled={signingIn} className="btn-pill btn-light hidden sm:inline-flex">
            {signingIn ? "Redirecting…" : "Log in"}
          </button>
          <button onClick={onStart} disabled={signingIn} className="btn-pill btn-dark">Start free</button>
        </div>
      </div>

      {open && (
        <motion.nav initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="surface mx-4 flex flex-col p-2 md:hidden">
          {links.map(([label, href]) => (
            <a key={href} href={href} onClick={() => setOpen(false)}
              className="rounded-xl px-4 py-3 text-sm text-foreground hover:bg-muted">{label}</a>
          ))}
          <button onClick={() => { setOpen(false); onSignIn(); }}
            className="rounded-xl px-4 py-3 text-left text-sm text-foreground hover:bg-muted">Log in</button>
        </motion.nav>
      )}
    </header>
  );
}

// ─── The scroll story: a game report that builds itself ─────────────────────

const STAGES = [
  { a: "Paste a link.", b: "Reel watches the whole game." },
  { a: "Every possession, logged.", b: "Both teams, timestamped." },
  { a: "Every decision, graded.", b: "The way a coach would." },
  { a: "The box score writes itself.", b: "Checked against the scoreboard." },
];

const PLAYS = [
  { t: "0:21", who: "White #12", q: "poor", what: "Forced a pass into the lane" },
  { t: "0:30", who: "Black #21", q: "good", what: "Stayed vertical, blocked it at the rim" },
  { t: "1:37", who: "Black #30", q: "good", what: "Sealed the post, scored through contact" },
  { t: "2:02", who: "White #23", q: "good", what: "Drove middle, kicked to the wing" },
  { t: "2:25", who: "White #7", q: "neutral", what: "Open mid-range off the catch" },
] as const;

const STORY_PHOTO = "https://images.unsplash.com/photo-1585032083927-c7b26d6c1d07?w=1600&q=75&auto=format&fit=crop";

const BOX = [
  ["#30", "Storm", 17, 6, 3], ["#12", "Wolves", 15, 4, 5], ["#21", "Storm", 12, 11, 1],
  ["#23", "Wolves", 11, 9, 2], ["#7", "Wolves", 10, 3, 4],
] as const;

// 0..1 across [a, b], clamped.
function useStage(p: MotionValue<number>, a: number, b: number) {
  return useTransform(p, [a, b], [0, 1], { clamp: true });
}

function StageHeadline({ i, p }: { i: number; p: MotionValue<number> }) {
  const n = STAGES.length, w = 1 / n;
  const start = i * w, end = (i + 1) * w;
  // Fade in over the first slice of the stage, out over the last — the first
  // is visible from the top, the last stays at the end.
  const opacity = useTransform(p,
    [start - 0.04, start + 0.03, end - 0.05, end + 0.02],
    [i === 0 ? 1 : 0, 1, 1, i === n - 1 ? 1 : 0]);
  const y = useTransform(p, [start - 0.04, start + 0.03, end - 0.05, end + 0.02], [i === 0 ? 0 : 24, 0, 0, i === n - 1 ? 0 : -24]);
  return (
    <motion.div style={{ opacity, y }} className="absolute inset-x-0 top-0">
      <Heading a={STAGES[i].a} b={STAGES[i].b} className="text-center text-3xl sm:text-5xl" />
    </motion.div>
  );
}

// Wide screens put the panel beside the film; phones put it underneath.
function useWide() {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setWide(mq.matches);
    on(); mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

// One idea on screen at a time: the film alone, then the film with ONE panel
// beside it (the timeline, which then hands over to the grade card), then the
// box score taking over the whole window. Nothing is ever layered on the film
// except the tracking box.
function AppWindow({ p, still = false }: { p: MotionValue<number>; still?: boolean }) {
  const wide = useWide();
  const split     = useStage(p, 0.22, 0.32);            // film makes room
  const playsIn   = useStage(p, 0.27, 0.34);
  const playsOut  = useStage(p, 0.48, 0.53);
  const gradeIn   = useStage(p, 0.53, 0.6);
  const boxIn     = useStage(p, 0.74, 0.84);
  const trackIn   = useStage(p, 0.03, 0.1);
  const playhead  = useTransform(p, [0, 1], ["4%", "96%"]);
  const filmZoom  = useTransform(p, [0, 0.7], [1, 1.1]);

  const filmW = useTransform(split, [0, 1], ["100%", "58%"]);
  const filmH = useTransform(split, [0, 1], ["100%", "52%"]);
  const playsOpacity = useTransform([playsIn, playsOut], ([i, o]: number[]) => i * (1 - o));
  const playsY = useTransform(playsIn, [0, 1], [16, 0]);
  const gradeY = useTransform(gradeIn, [0, 1], [16, 0]);
  const boxY = useTransform(boxIn, [0, 1], ["100%", "0%"]);
  const filmDim = useTransform(boxIn, [0, 1], [1, 0.4]);

  const panel = wide
    ? "absolute inset-y-0 right-0 w-[42%]"
    : "absolute inset-x-0 bottom-0 h-[48%]";

  return (
    <div className="relative mx-auto w-full overflow-hidden rounded-[22px] bg-card text-left shadow-lift ring-1 ring-black/5">
      {/* Title bar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" /><span className="h-3 w-3 rounded-full bg-[#febc2e]" /><span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <p className="truncate text-sm text-foreground">Lakeview Wolves vs Harbor City Storm</p>
        <span className="ml-auto hidden rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground sm:inline">Game report</span>
      </div>

      <div className={`relative w-full ${wide ? "aspect-[16/9]" : "aspect-[4/5]"}`}>
        {/* Film */}
        <motion.div style={wide ? { width: still ? "58%" : filmW, opacity: still ? 1 : filmDim } : { height: still ? "52%" : filmH, opacity: still ? 1 : filmDim }}
          className="absolute left-0 top-0 h-full w-full overflow-hidden bg-muted">
          {/* A still from real film with a slow push-in tied to scroll — the
              clip format didn't decode in every browser, a still always does. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {/* Stock photo (Unsplash License): adults, fictional teams — white
              is the Wolves, black-and-orange is the Storm. */}
          <motion.img src={STORY_PHOTO} alt="Basketball game film being analyzed"
            style={{ scale: still ? 1.04 : filmZoom }} className="h-full w-full origin-[48%_50%] object-cover object-[50%_40%]" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
          <motion.div style={{ opacity: still ? 1 : trackIn, left: "41%", top: "22%", width: "14%", height: "64%" }} className="absolute">
            <div className="h-full w-full rounded-xl border-2 border-white/90" />
            <span className="absolute -top-6 left-0 whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-black">Black #21</span>
          </motion.div>
          <div className="absolute inset-x-4 bottom-3 h-1 rounded-full bg-white/30">
            <motion.div style={{ width: still ? "40%" : playhead }} className="h-full rounded-full bg-white" />
          </div>
        </motion.div>

        {/* The one panel beside the film */}
        <div className={panel}>
          <motion.div style={{ opacity: still ? 0 : playsOpacity, y: still ? 0 : playsY }} className="absolute inset-0 overflow-hidden p-4 sm:p-5">
            <p className="mb-2 text-[12px] text-muted-foreground">Decision timeline · 162 plays</p>
            <div className="divide-y divide-border">
              {PLAYS.map((pl, k) => <PlayRow key={k} i={k} p={p} still={still} {...pl} />)}
            </div>
          </motion.div>
          <motion.div style={{ opacity: still ? 1 : gradeIn, y: still ? 0 : gradeY }} className="absolute inset-0 flex flex-col justify-center p-5 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-sm font-semibold text-white">A-</span>
              <div className="min-w-0">
                <p className="text-[15px] text-foreground">Black #21 · Center</p>
                <p className="text-[12px] text-muted-foreground">0:30 · Rim protection</p>
              </div>
            </div>
            <p className="mt-4 text-[12px] text-muted-foreground">The read</p>
            <p className="mt-1 text-[14px] leading-snug text-foreground">Stayed home, went straight up instead of reaching. Right read, on time.</p>
            <p className="mt-3 text-[12px] text-muted-foreground">Better option</p>
            <p className="mt-1 text-[14px] leading-snug text-foreground">None. This is the play.</p>
          </motion.div>
        </div>

        {/* Box score takes over the window */}
        <motion.div style={{ y: still ? "100%" : boxY }} className="absolute inset-0 overflow-hidden bg-card p-5 sm:p-7">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[12px] text-muted-foreground">Final · read off the scoreboard</p>
              <p className="mt-1 font-display text-4xl tabular-nums sm:text-5xl"><span className="text-quiet">Wolves 51</span> – Storm 54</p>
            </div>
            <p className="pb-1 text-right text-[12px] text-muted-foreground">101 of 105 points<br className="sm:hidden" /> tracked</p>
          </div>
          <div className="mt-5 divide-y divide-border text-sm">
            <div className="grid grid-cols-[3rem_1fr_repeat(3,2.75rem)] pb-2 text-[11px] text-muted-foreground">
              <span>#</span><span>Team</span><span className="text-right">PTS</span><span className="text-right">REB</span><span className="text-right">AST</span>
            </div>
            {BOX.map(([n, team, pts, reb, ast], k) => (
              <div key={n + team} className="grid grid-cols-[3rem_1fr_repeat(3,2.75rem)] py-2 tabular-nums">
                <span className="font-mono">{n}</span><span className="text-muted-foreground">{team}</span>
                <span className={`text-right ${k === 0 ? "font-semibold" : ""}`}>{pts}</span><span className={`text-right ${k === 0 ? "font-semibold" : ""}`}>{reb}</span><span className="text-right">{ast}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function PlayRow({ i, p, still, t, who, q, what }: { i: number; p: MotionValue<number>; still: boolean; t: string; who: string; q: string; what: string }) {
  const start = 0.29 + i * 0.03;
  const o = useTransform(p, [start, start + 0.03], [0, 1]);
  const y = useTransform(p, [start, start + 0.03], [8, 0]);
  const dot = q === "good" ? "bg-emerald-500" : q === "poor" ? "bg-red-500" : "bg-zinc-400";
  return (
    <motion.div style={{ opacity: still ? 1 : o, y: still ? 0 : y }} className="flex items-start gap-3 py-2.5">
      <span className="w-9 shrink-0 pt-px font-mono text-[12px] text-muted-foreground">{t}</span>
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      <span className="min-w-0 text-[13px] leading-snug"><span className="text-foreground">{who}</span> <span className="text-muted-foreground">{what}</span></span>
    </motion.div>
  );
}

function ScrollStory() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const p = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.4 });
  const windowScale = useTransform(p, [0, 0.12], [0.94, 1]);

  if (reduce) {
    return (
      <section id="film" className="px-4 py-24 sm:px-6">
        <Heading a="Paste a link." b="Get the whole game back, graded." className="mb-12 text-center text-3xl sm:text-5xl" />
        <AppWindow p={p} still />
      </section>
    );
  }

  return (
    <section id="film" ref={ref} className="relative h-[420vh] px-4 sm:px-6">
      <div className="sticky top-0 flex h-svh flex-col items-center justify-center gap-6 pt-24 sm:gap-8">
        <div className="relative h-[5.5rem] w-full max-w-3xl sm:h-[7.5rem]">
          {STAGES.map((_, i) => <StageHeadline key={i} i={i} p={p} />)}
        </div>
        {/* Width follows the viewport's height so the whole window (and the
            headline above it) always fits on screen while pinned. */}
        <motion.div style={{ scale: windowScale, width: "min(100%, calc((100svh - 18rem) * 1.75))" }}>
          <AppWindow p={p} />
        </motion.div>
        {/* Stage dots */}
        <div className="flex gap-2">
          {STAGES.map((_, i) => <StageDot key={i} i={i} p={p} />)}
        </div>
      </div>
    </section>
  );
}

function StageDot({ i, p }: { i: number; p: MotionValue<number> }) {
  const w = 1 / STAGES.length;
  const width = useTransform(p, [i * w - 0.02, i * w + 0.02, (i + 1) * w - 0.02, (i + 1) * w + 0.02], [6, 22, 22, 6]);
  const opacity = useTransform(width, [6, 22], [0.25, 1]);
  return <motion.span style={{ width, opacity }} className="h-1.5 rounded-full bg-foreground" />;
}

// ─── CoachIQ: a conversation that plays as you scroll ────────────────────────

const CHAT = [
  { me: true, text: "Why do I keep getting my drives blocked?" },
  { me: false, text: "You're picking up your dribble at the dotted line. The help sees it coming and has a full second to rotate." },
  { me: false, text: "Keep the live dribble one step longer, then decide: finish, or kick to the wing that just got open." },
  { me: true, text: "What do I practice?" },
  { me: false, text: "Two-dribble attack, 5 sets of 10. Cue: eyes up on the second dribble. Then record it — Drill Check will tell you if you fixed it." },
];

function CoachSection() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  // Scroll decides how many messages are in the conversation; each one then
  // animates in on its own, so the thread builds like a real chat.
  const [shown, setShown] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", v =>
    setShown(Math.max(0, Math.min(CHAT.length, Math.floor((v - 0.05) / 0.18) + 1))));
  return (
    <section id="coach" ref={ref} className={reduce ? "px-4 py-24 sm:px-6" : "relative h-[260vh] px-4 sm:px-6"}>
      <div className={reduce ? "mx-auto max-w-6xl" : "sticky top-0 mx-auto flex h-screen max-w-6xl items-center"}>
        <div className="grid w-full items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="mb-5 font-mono text-xs text-muted-foreground">CoachIQ</p>
            <Heading a="A coach who has" b="actually seen your film." className="text-4xl sm:text-6xl" />
            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              Ask anything. Get a weekly plan built around what the film showed. Record a drill and get told whether your form fixed it.
            </p>
          </div>
          <div className="surface flex min-h-[26rem] flex-col justify-end gap-3 p-5 sm:p-6">
            {CHAT.map((m, i) => <ChatBubble key={i} on={!!reduce || i < shown} {...m} />)}
          </div>
        </div>
      </div>
    </section>
  );
}

function ChatBubble({ on, me, text }: { on: boolean; me: boolean; text: string }) {
  return (
    <motion.div initial={false} animate={{ opacity: on ? 1 : 0, y: on ? 0 : 14, scale: on ? 1 : 0.98 }}
      transition={{ duration: 0.45, ease: EASE }}
      className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[14px] leading-snug ${me ? "self-end bg-primary text-primary-foreground" : "self-start bg-muted text-foreground"} ${me ? "origin-bottom-right" : "origin-bottom-left"}`}>
      {text}
    </motion.div>
  );
}

// ─── Mission: words light up as you read ─────────────────────────────────────

const MISSION = "Talent is everywhere. Opportunity isn't. A private coach runs $100 to $300 an hour, so most athletes never get real feedback on their film. Reel gives every athlete a film room, free to start.";

function Mission() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.8", "end 0.45"] });
  const words = MISSION.split(" ");
  return (
    <section className="mx-auto max-w-4xl px-4 py-28 sm:px-6 sm:py-40">
      <div ref={ref} className="font-display text-3xl leading-[1.25] sm:text-5xl">
        {words.map((w, i) => (
          <Word key={i} p={scrollYProgress} range={[i / words.length, (i + 1) / words.length]} still={!!reduce}>{w}</Word>
        ))}
      </div>
    </section>
  );
}

function Word({ p, range, still, children }: { p: MotionValue<number>; range: [number, number]; still: boolean; children: string }) {
  const opacity = useTransform(p, range, [0.18, 1]);
  return <motion.span style={{ opacity: still ? 1 : opacity }} className="inline-block pr-[0.25em]">{children}</motion.span>;
}

// ─── Pricing ─────────────────────────────────────────────────────────────────

function Pricing({ onStart }: { onStart: () => void }) {
  const plans = [
    { name: "Free", price: "$0", note: "No card required", rows: [["Full games", "1 / month"], ["Clips", "2 / month"], ["Coach messages", "15 / month"], ["Practice plans", "1 / month"], ["Teams", "1"]], cta: "Start free", pro: false },
    { name: "Pro", price: "$8", note: "per month", rows: [["Full games", "8 / month"], ["Clips", "100 / month"], ["Coach messages", "1,000 / month"], ["Practice plans", "50 / month"], ["Teams", "Unlimited"]], cta: "Go Pro", pro: true },
  ];
  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-28 sm:px-6 sm:py-40">
      <Reveal className="text-center">
        <Heading a="Two plans." b="Start free, no card." className="text-4xl sm:text-6xl" />
      </Reveal>
      <div className="mt-16 grid gap-5 md:grid-cols-2">
        {plans.map((plan, i) => (
          <Reveal key={plan.name} delay={i * 0.08}>
            <div className={`surface h-full p-8 sm:p-10 ${plan.pro ? "ring-1 ring-foreground/10" : ""}`}>
              <div className="flex items-baseline justify-between">
                <p className="text-sm text-foreground">{plan.name}</p>
                <p className="text-sm text-muted-foreground">{plan.note}</p>
              </div>
              <p className="mt-3 font-display text-6xl">{plan.price}</p>
              <div className="mt-8 divide-y divide-border border-y border-border">
                {plan.rows.map(([k, v]) => (
                  <div key={k} className="flex justify-between py-3 text-sm">
                    <span className="text-foreground">{k}</span><span className="text-muted-foreground">{v}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => { if (plan.pro) { try { localStorage.setItem("reel-upgrade-intent", "1"); } catch {} } onStart(); }}
                className={`btn-pill mt-8 w-full ${plan.pro ? "btn-dark" : "btn-light"}`}>
                {plan.cta}
              </button>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Landing({ onStart, onSignIn, onEnterApp, signingIn, authError }: LandingProps) {
  const reduce = useReducedMotion();
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroY = useTransform(scrollYProgress, [0, 1], [0, -80]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  const rise = (d: number) => reduce ? {} : {
    initial: { opacity: 0, y: 22 }, animate: { opacity: 1, y: 0 },
    transition: { duration: 0.9, delay: d, ease: EASE },
  };

  return (
    <div id="top" className="min-h-screen overflow-x-clip bg-background text-foreground">
      <Header onStart={onStart} onSignIn={onSignIn} signingIn={signingIn} />

      {/* Hero */}
      <section ref={heroRef} className="relative flex min-h-[92vh] items-center justify-center overflow-hidden px-4 pb-10 pt-28 sm:px-6">
        <motion.div style={reduce ? {} : { y: heroY, opacity: heroOpacity }} className="relative mx-auto w-full max-w-3xl text-center">
          {/* The scoreboard shows the score, then what it never shows:
              how you played. */}
          <motion.div {...rise(0.05)}>
            <HeroBoard />
          </motion.div>
          <motion.div {...rise(0.2)} className="mt-10 sm:mt-12">
            <Heading as="h1" a="Every game has a score." b="Reel grades how you played." className="text-4xl sm:text-6xl" />
          </motion.div>
          <motion.p {...rise(0.3)} className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Paste a YouTube link. Reel grades every decision on the floor, builds the box score, and gives you the drill that fixes what it found.
          </motion.p>
          <motion.div {...rise(0.42)} className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <button onClick={onStart} disabled={signingIn} className="btn-pill btn-dark !px-6 !py-3.5">
              Start free <ArrowRight className="h-4 w-4" />
            </button>
            <button onClick={onEnterApp} className="btn-pill btn-light !px-6 !py-3.5">
              <Play className="h-3.5 w-3.5" /> Try without an account
            </button>
          </motion.div>
          <motion.p {...rise(0.5)} className="mt-5 text-xs text-muted-foreground">Free plan · No card · Works on any public game video</motion.p>
          {authError && <p className="mt-4 text-sm text-destructive">{authError}</p>}
        </motion.div>
      </section>

      <ScrollStory />
      <FilmStrip />
      <ChalkboardPlay />
      <SeasonScoreboard />
      <CoachSection />
      <GiantGrade />
      <Mission />
      <Pricing onStart={onStart} />

      {/* Closing */}
      <section className="px-4 pb-32 pt-10 text-center sm:px-6">
        <Reveal>
          <Heading a="Your next game is on film." b="Find out what it says." className="text-4xl sm:text-6xl" />
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <button onClick={onStart} disabled={signingIn} className="btn-pill btn-dark !px-6 !py-3.5">Start free <ArrowRight className="h-4 w-4" /></button>
            <button onClick={onSignIn} disabled={signingIn} className="btn-pill btn-light !px-6 !py-3.5">Log in</button>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-border px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 text-sm text-muted-foreground sm:flex-row sm:justify-between">
          <p><span className="font-display text-foreground">Reel</span> · The AI film room</p>
          <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            <a href="/privacy" className="hover:text-foreground">Privacy</a>
            <a href="/terms" className="hover:text-foreground">Terms</a>
            <a href="/accessibility" className="hover:text-foreground">Accessibility</a>
            <a href="mailto:support@getreel.org" className="hover:text-foreground">Contact</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
