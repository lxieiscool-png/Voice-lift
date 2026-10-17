"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";

// Shared motion primitives. Four effects, chosen because they say something
// about a sports product rather than because they move:
//
//   SplitFlap  — the arena flip board. Grades and scores land instead of
//                appearing, which makes a result feel announced.
//   CountUp    — numbers that roll to their value, so a stat reads as counted.
//   Kinetic    — type that assembles word by word, for one headline per page.
//   FilmScan   — a dot grid of the actual game, lighting up as segments
//                finish. Decorative and informative at once.
//
// Every one of them collapses to its final state under prefers-reduced-motion,
// so nothing here is load-bearing for comprehension.

const EASE = [0.22, 1, 0.36, 1] as const;

// ─── Split-flap board ────────────────────────────────────────────────────────

const FLAP_SET = "ABCDEF0123456789+-";

// One flap slot. The new glyph always drops into place. With `riffle` it
// first spins through a few random characters, the way a mechanical board
// hunts for its letter — good for a result that lands once, bad for a counter
// that updates every few seconds, where it just makes the number unreadable.
function Flap({ value, riffle = false, className = "" }: { value: string; riffle?: boolean; className?: string }) {
  const reduce = useReducedMotion();
  // Without riffling there is no intermediate state to hold, so the value is
  // read straight through during render rather than mirrored into state.
  const spins = riffle && !reduce;
  const [shown, setShown] = useState(value);
  const settled = useRef(value);
  const glyph = spins ? shown : value;

  useEffect(() => {
    settled.current = value;
    if (!spins || shown === value) return;
    let step = 0;
    const id = setInterval(() => {
      step++;
      if (step >= 5) {
        clearInterval(id);
        setShown(settled.current);
      } else {
        setShown(FLAP_SET[Math.floor(Math.random() * FLAP_SET.length)]);
      }
    }, 55);
    return () => clearInterval(id);
    // Riffling depends only on the target; `shown` is the thing being driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, spins]);

  return (
    <span className={`relative inline-block overflow-hidden tabular-nums ${className}`}>
      {/* Keyed on the glyph so each change restarts the flip. */}
      <span key={glyph} className={reduce ? "block" : "block [animation:flap_160ms_ease-out]"}>
        {glyph === " " ? " " : glyph}
      </span>
      {/* The seam across the middle of a real flap. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-current opacity-[0.07]" />
    </span>
  );
}

export function SplitFlap({ text, riffle = false, className = "" }: { text: string; riffle?: boolean; className?: string }) {
  const chars = useMemo(() => [...String(text)], [text]);
  // Per-character spans read one letter at a time to a screen reader, and the
  // mid-flip glyphs are nonsense anyway — so the flaps are hidden and the real
  // value is exposed once, as text.
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>{chars.map((c, i) => <Flap key={i} value={c} riffle={riffle} />)}</span>
    </span>
  );
}

// ─── Count-up ────────────────────────────────────────────────────────────────

// Rolls to `value` the first time it scrolls into view. Holds integers only —
// a stat that rolls through decimals reads as noise.
export function CountUp({ value, decimals = 0, suffix = "", className = "", duration = 900 }: {
  value: number; decimals?: number; suffix?: string; className?: string; duration?: number;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [n, setN] = useState(0);
  // With motion reduced the final value is read through during render, so the
  // effect never has to set state synchronously just to skip the animation.
  const display = reduce ? value : n;

  useEffect(() => {
    if (reduce || !inView) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      // Ease out cubic: fast off the line, settles onto the number.
      setN(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration, reduce]);

  return <span ref={ref} className={`tabular-nums ${className}`}>{display.toFixed(decimals)}{suffix}</span>;
}

// ─── Kinetic type ────────────────────────────────────────────────────────────

// A headline that assembles word by word. Words, not characters: character
// staggers on a long line read as a glitch, not as type.
export function Kinetic({ text, className = "", delay = 0 }: {
  text: string; className?: string; delay?: number;
}) {
  const reduce = useReducedMotion();
  const words = useMemo(() => text.split(" "), [text]);

  if (reduce) return <span className={className}>{text}</span>;

  // The variants live on one static motion.span. Indexing `motion[Tag]` to
  // get a dynamic element would mint a brand-new component type on every
  // render, which React 19 rejects outright with a "slots" TypeError.
  return (
    <motion.span className={className} initial="hide" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
      {words.map((w, i) => (
        // The clip wrapper is what makes it read as type rising off a
        // baseline rather than fading in place. The space between words is a
        // real text node, not padding — padding would render the same but
        // leave the heading as one run-on word to a screen reader or to
        // anyone copying it.
        <Fragment key={i}>
          <span className="inline-block overflow-hidden align-bottom">
            <motion.span className="inline-block"
              variants={{ hide: { y: "110%", opacity: 0 }, show: { y: 0, opacity: 1 } }}
              transition={{ duration: 0.7, delay: delay + i * 0.055, ease: EASE }}>
              {w}
            </motion.span>
          </span>
          {i < words.length - 1 ? " " : ""}
        </Fragment>
      ))}
    </motion.span>
  );
}

// ─── Gradient mesh ───────────────────────────────────────────────────────────

// A slow warm wash behind the hero.
//
// This is deliberately ONE element painting three radial gradients as a
// background image, rather than three positioned children. Children each get
// promoted to their own compositing layer, and on this stack that washed out
// every sibling in the section — the scoreboard, the headline and the buttons
// all rendered as pale grey while the DOM still reported full opacity. A
// background image cannot create sibling layers, so it cannot do that.
export function GradientMesh({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden
      className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden opacity-[0.5] dark:opacity-[0.35] ${className}`}
      style={{
        backgroundImage: [
          "radial-gradient(42rem 34rem at 12% 18%, color-mix(in srgb, var(--court) 26%, transparent), transparent 70%)",
          "radial-gradient(36rem 30rem at 82% 24%, color-mix(in srgb, #5b8def 22%, transparent), transparent 70%)",
          "radial-gradient(34rem 28rem at 52% 82%, color-mix(in srgb, var(--court) 18%, transparent), transparent 70%)",
        ].join(", "),
      }} />
  );
}

// ─── Film scan ───────────────────────────────────────────────────────────────

// The waiting state for a game analysis, which can run for minutes. A dot per
// segment of the actual film: finished segments are lit, the one being watched
// pulses, and a scan sweeps the rest. It's the same dot-matrix language as the
// scoreboard on the landing page, and it answers "how far in is it" honestly —
// the lit count is real progress, not a guess.
export function FilmScan({ current, total, className = "" }: { current: number; total: number; className?: string }) {
  const reduce = useReducedMotion();
  const COLS = 24;
  // With no segment count yet (the video is still being measured) show a full
  // grid being swept, so the panel doesn't sit empty.
  const cells = total > 0 ? Math.max(total, COLS) : COLS * 3;
  const rows = Math.ceil(cells / COLS);
  const done = total > 0 ? Math.round((current / total) * cells) : 0;

  return (
    <div className={`w-full ${className}`} aria-hidden>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
        {Array.from({ length: rows * COLS }, (_, i) => {
          const lit = i < done;
          const head = i === done && total > 0;
          const pending = !lit && !head;
          return (
            <span key={i}
              className={`aspect-square rounded-[2px] bg-foreground ${lit ? "!bg-court" : ""} ${
                !reduce && pending ? "[animation:sweep_2.4s_ease-in-out_infinite]" : ""
              } ${!reduce && head ? "animate-pulse" : ""}`}
              // Pending dots carry their resting opacity inline so they stay
              // faint when motion is reduced and the sweep never runs. The
              // delay staggers along the row, so it reads as a scan line
              // travelling across the film, not the whole grid blinking.
              style={pending ? { opacity: 0.08, animationDelay: `${(i % COLS) * 60 + Math.floor(i / COLS) * 120}ms` } : undefined} />
          );
        })}
      </div>
    </div>
  );
}

// ─── Reveal ──────────────────────────────────────────────────────────────────

// Fade and rise the first time something scrolls into view. The `index` form
// staggers a list so rows arrive in order instead of all at once, which is
// what makes a table read as filling in rather than flashing.
export function Reveal({ children, index = 0, className = "", step = 0.035, max = 12 }: {
  children: React.ReactNode; index?: number; className?: string; step?: number; max?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className}
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      // Cap the stagger: a 40-row box score would otherwise take 1.4s to
      // finish, and the last rows would feel broken rather than staggered.
      transition={{ duration: 0.45, delay: Math.min(index, max) * step, ease: EASE }}>
      {children}
    </motion.div>
  );
}

// ─── Counted stat ────────────────────────────────────────────────────────────

// Rolls the numeric part of an already-formatted stat ("14.2", "47%", "8/12")
// and leaves everything around it alone. Season totals and box scores are
// counted from film, so they read better arriving at a number than sitting on
// one. Anything without a leading number is passed straight through.
export function CountUpText({ text, className = "" }: { text: string; className?: string }) {
  const m = /^(-?\d+(?:\.\d+)?)([\s\S]*)$/.exec(String(text).trim());
  if (!m) return <span className={className}>{text}</span>;
  const [, num, rest] = m;
  const decimals = num.includes(".") ? num.split(".")[1].length : 0;
  return (
    <span className={className}>
      <CountUp value={parseFloat(num)} decimals={decimals} duration={700} />{rest}
    </span>
  );
}
