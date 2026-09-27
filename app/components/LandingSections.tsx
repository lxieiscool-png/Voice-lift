"use client";

import { useEffect, useRef, useState } from "react";
import {
  motion, useScroll, useTransform, useReducedMotion, useInView, useMotionValueEvent, animate,
} from "framer-motion";

// Four landing sections, each making one point with its own motion:
//   FilmStrip        — every play gets graded (frames drift past with grades)
//   ChalkboardPlay   — coaching, not just counting (the better read draws itself)
//   SeasonScoreboard — the season adds up (numbers count up into place)
//   GiantGrade       — you get better (a huge grade climbs as you scroll)

const EASE = [0.22, 1, 0.36, 1] as const;

function Heading({ a, b, className = "" }: { a: string; b: string; className?: string }) {
  return (
    <h2 className={`font-display font-normal leading-[1.04] ${className}`}>
      <span className="block">{a}</span>
      <span className="block text-quiet">{b}</span>
    </h2>
  );
}

function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={reduce ? false : { opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.8, delay, ease: EASE }}>
      {children}
    </motion.div>
  );
}

// ─── 1. Film strip ───────────────────────────────────────────────────────────

// Crops of real game film. Two source photos, framed differently, read as a
// run of different moments.
const FRAMES = [
  { src: "/demo-basketball.jpg", pos: "55% 35%", t: "0:21", who: "White #12", g: "C", tone: "court" },
  { src: "/grid-basketball.jpg", pos: "57% 42%", t: "0:30", who: "Blue #30", g: "A-", tone: "good" },
  { src: "/demo-basketball.jpg", pos: "30% 55%", t: "1:37", who: "Blue #4", g: "B+", tone: "good" },
  { src: "/grid-basketball.jpg", pos: "88% 68%", t: "2:02", who: "White #23", g: "A", tone: "good" },
  { src: "/demo-basketball.jpg", pos: "70% 40%", t: "2:25", who: "White #7", g: "B-", tone: "mid" },
  { src: "/grid-basketball.jpg", pos: "60% 72%", t: "3:10", who: "Blue #11", g: "D", tone: "court" },
] as const;

export function FilmStrip() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  // Scroll drives the strip sideways, so the frames move with the reader.
  const x = useTransform(scrollYProgress, [0, 1], ["2%", "-38%"]);
  const frames = [...FRAMES, ...FRAMES];
  const chip = (tone: string) => tone === "good" ? "bg-emerald-500 text-white" : tone === "court" ? "bg-court text-white" : "bg-amber-400 text-amber-950";
  return (
    <section ref={ref} className="overflow-hidden py-28 sm:py-36">
      <Reveal className="mx-auto mb-14 max-w-6xl px-4 sm:px-6">
        <Heading a="Every play, graded." b="Not just the highlights." className="text-4xl sm:text-5xl" />
      </Reveal>
      <div className="bg-foreground py-4">
        {/* Sprocket holes */}
        <div className="mb-3 flex gap-5 overflow-hidden px-2 opacity-40">{Array.from({ length: 80 }, (_, i) => <span key={i} className="h-2.5 w-4 shrink-0 rounded-sm bg-background" />)}</div>
        <motion.div style={reduce ? {} : { x }} className="flex w-max gap-3 px-3">
          {frames.map((f, i) => (
            <div key={i} className="relative h-44 w-72 shrink-0 overflow-hidden rounded-lg sm:h-52 sm:w-80">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.src} alt="" className="h-full w-full object-cover" style={{ objectPosition: f.pos }} loading="lazy" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <span className={`absolute right-3 top-3 flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-[13px] font-medium ${chip(f.tone)}`}>{f.g}</span>
              <p className="absolute bottom-3 left-3 text-[13px] text-white"><span className="font-mono text-white/70">{f.t}</span> · {f.who}</p>
            </div>
          ))}
        </motion.div>
        <div className="mt-3 flex gap-5 overflow-hidden px-2 opacity-40">{Array.from({ length: 80 }, (_, i) => <span key={i} className="h-2.5 w-4 shrink-0 rounded-sm bg-background" />)}</div>
      </div>
    </section>
  );
}

// ─── 2. Chalkboard play ──────────────────────────────────────────────────────

// Half court in dots, viewBox 400×300, baseline at the bottom.
const COURT = "M20 290 L20 150 Q200 -10 380 150 L380 290";
const LANE = "M150 290 L150 180 L250 180 L250 290";

export function ChalkboardPlay() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once: true, margin: "-120px" });
  const on = reduce || inView;
  const draw = (delay: number) => ({
    initial: reduce ? false : { pathLength: 0, opacity: 0 },
    animate: on ? { pathLength: 1, opacity: 1 } : {},
    transition: { pathLength: { delay, duration: 0.9, ease: EASE }, opacity: { delay, duration: 0.2 } },
  });
  const pop = (delay: number) => ({
    initial: reduce ? false : { opacity: 0, scale: 0.6 },
    animate: on ? { opacity: 1, scale: 1 } : {},
    transition: { delay, duration: 0.4, ease: EASE },
  });
  return (
    <section className="mx-auto max-w-6xl px-4 py-28 sm:px-6 sm:py-36">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <Reveal>
          <Heading a="Coached, not counted." b="Every grade shows the better read." className="text-4xl sm:text-5xl" />
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            A stat tells you the drive ended in a turnover. Reel tells you the corner was open two dribbles earlier, and gives you the drill that builds the habit.
          </p>
        </Reveal>
        <div ref={ref} className="surface p-5 sm:p-8">
          <svg viewBox="0 0 400 300" className="w-full text-foreground" aria-label="A half court diagram where the better pass draws itself">
            <path d={COURT} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" strokeDasharray="0.1 9" strokeLinecap="round" />
            <path d="M20 290 L380 290" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" strokeDasharray="0.1 9" strokeLinecap="round" />
            <path d={LANE} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" strokeDasharray="0.1 9" strokeLinecap="round" />
            <motion.ellipse cx="200" cy="278" rx="16" ry="5" fill="none" stroke="var(--court)" strokeWidth="2.5" {...pop(0.1)} />
            {/* Players */}
            {[[120, 170, "1"], [300, 150, "2"], [360, 272, "3"]].map(([x, y, n], i) => (
              <motion.g key={i} {...pop(0.25 + i * 0.12)}>
                <circle cx={x as number} cy={y as number} r="13" fill="var(--card)" stroke="currentColor" strokeWidth="2" />
                <text x={x as number} y={(y as number) + 4.5} textAnchor="middle" fontSize="13" fill="currentColor">{n}</text>
              </motion.g>
            ))}
            {[[190, 200], [275, 205]].map(([x, y], i) => (
              <motion.text key={i} x={x} y={y} textAnchor="middle" fontSize="20" fill="currentColor" fillOpacity="0.45" {...pop(0.55 + i * 0.1)}>×</motion.text>
            ))}
            {/* What happened: forced drive into the help */}
            <motion.path d="M130 180 Q170 215 186 238" fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="2.5" strokeLinecap="round" {...draw(0.9)} />
            <motion.text x="150" y="252" fontSize="13" fill="currentColor" fillOpacity="0.55" {...pop(1.6)}>Forced into the help</motion.text>
            {/* The better read: skip to the corner */}
            <motion.path d="M132 164 Q250 120 347 262" fill="none" stroke="var(--court)" strokeWidth="3" strokeDasharray="8 7" strokeLinecap="round" {...draw(1.9)} />
            <motion.g {...pop(2.8)}>
              <rect x="230" y="96" width="126" height="28" rx="14" fill="var(--court)" />
              <text x="293" y="115" textAnchor="middle" fontSize="13" fill="white">Better read: skip</text>
            </motion.g>
          </svg>
        </div>
      </div>
    </section>
  );
}

// ─── 3. Season scoreboard ────────────────────────────────────────────────────

function CountUp({ to, decimals = 0, suffix = "", on }: { to: number; decimals?: number; suffix?: string; on: boolean }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!on) return;
    const c = animate(0, to, { duration: 1.6, ease: EASE, onUpdate: setV });
    return () => c.stop();
  }, [on, to]);
  return <>{v.toFixed(decimals)}{suffix}</>;
}

const SEASON = [
  { label: "Record", a: 12, b: 4, fmt: "record" },
  { label: "Points per game", v: 14.2, d: 1 },
  { label: "Field goal %", v: 47, s: "%" },
  { label: "Good decisions", v: 68, s: "%" },
] as const;
const PPG = [8, 11, 9, 14, 12, 17, 13, 16, 18, 15, 19, 21];

export function SeasonScoreboard() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once: true, margin: "-120px" });
  const on = !!reduce || inView;
  const max = Math.max(...PPG);
  return (
    <section className="mx-auto max-w-6xl px-4 py-28 sm:px-6 sm:py-36">
      <Reveal className="mb-14">
        <Heading a="Your season, tallied." b="Every game adds to it." className="text-4xl sm:text-5xl" />
      </Reveal>
      <div ref={ref} className="surface grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8">
          {SEASON.map(s => (
            <div key={s.label}>
              <p className="font-display text-5xl tabular-nums leading-none sm:text-6xl">
                {"fmt" in s
                  ? <><CountUp to={s.a} on={on} /><span className="text-quiet">–</span><CountUp to={s.b} on={on} /></>
                  : <CountUp to={s.v} decimals={"d" in s ? s.d : 0} suffix={"s" in s ? s.s : ""} on={on} />}
              </p>
              <p className="mt-2 text-[13px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-col justify-end">
          <p className="mb-3 text-[13px] text-muted-foreground">Points, game by game</p>
          <div className="flex h-40 items-end gap-1.5">
            {PPG.map((v, i) => (
              <motion.div key={i} className={`flex-1 rounded-t-md rounded-b-sm ${i === PPG.length - 1 ? "bg-court" : "bg-foreground/80"}`}
                initial={reduce ? false : { height: 0 }} animate={on ? { height: `${(v / max) * 100}%` } : {}}
                transition={{ delay: 0.2 + i * 0.06, duration: 0.7, ease: EASE }} />
            ))}
          </div>
          <p className="mt-3 text-[12px] text-muted-foreground">Counted from your film, checked against the scoreboard.</p>
        </div>
      </div>
    </section>
  );
}

// ─── 4. Giant grade ──────────────────────────────────────────────────────────

const LADDER = ["D", "C", "C+", "B-", "B", "B+"];

export function GiantGrade() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [idx, setIdx] = useState(reduce ? LADDER.length - 1 : 0);
  useMotionValueEvent(scrollYProgress, "change", v =>
    setIdx(Math.max(0, Math.min(LADDER.length - 1, Math.floor(v * LADDER.length * 1.05)))));
  const grade = LADDER[idx];
  const done = idx === LADDER.length - 1;
  // Trend line points for the reviews so far.
  const pts = LADDER.slice(0, idx + 1).map((_, i) => `${20 + i * 52},${150 - i * 24}`).join(" ");
  return (
    <section ref={ref} className={reduce ? "px-4 py-28 sm:px-6" : "relative h-[240vh] px-4 sm:px-6"}>
      <div className={reduce ? "mx-auto max-w-6xl" : "sticky top-0 mx-auto flex h-svh max-w-6xl items-center"}>
        <div className="grid w-full items-center gap-10 lg:grid-cols-2">
          <div>
            <Heading a="Watch yourself improve." b="Every review is saved." className="text-4xl sm:text-5xl" />
            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              Grades follow your decisions, not your stat line. Fix the habit Reel found, and the next game shows it.
            </p>
          </div>
          <div className="surface flex flex-col items-center p-6 sm:p-8">
            <div className="relative h-40 w-full overflow-hidden sm:h-48">
              <motion.p key={grade} initial={reduce ? false : { y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.45, ease: EASE }}
                className={`absolute inset-0 text-center font-display text-[8.5rem] leading-[1.15] tabular-nums sm:text-[10.5rem] ${done ? "text-foreground" : "text-quiet"}`}>
                {grade}
              </motion.p>
            </div>
            <svg viewBox="0 0 300 170" className="mt-2 w-full max-w-xs" aria-hidden>
              <polyline points={pts} fill="none" stroke={done ? "var(--court)" : "currentColor"} strokeOpacity={done ? 1 : 0.4} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" className="text-foreground" />
              {LADDER.slice(0, idx + 1).map((g, i) => (
                <g key={g}>
                  <circle cx={20 + i * 52} cy={150 - i * 24} r="5" fill={i === idx ? "var(--court)" : "var(--foreground)"} />
                  <text x={20 + i * 52} y={168} textAnchor="middle" fontSize="12" fill="var(--muted-foreground)">{g}</text>
                </g>
              ))}
            </svg>
            <p className="mt-2 text-[13px] text-muted-foreground">Game {idx + 1} of {LADDER.length}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
