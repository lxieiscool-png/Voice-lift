"use client";

import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";

// The hero: a gym LED scoreboard drawn dot by dot. It cycles like a real
// board — the score with a running clock, then the thing a scoreboard never
// shows: how you actually played. Each change wipes across the dots column by
// column. The board is a physical object, so it stays dark in both themes.

// 5×7 dot-matrix glyphs, one string per row, "#" = lit.
const G: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  ":": [".....", "..#..", "..#..", ".....", "..#..", "..#..", "....."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

const COLS = 96, ROWS = 23;
type Line = { text: string; scale?: 1 | 2 };

// Lit dots for a scene, each line centred horizontally, the block centred
// vertically. Glyphs are 5 wide with 1 column of spacing.
function render(lines: Line[]): Set<number> {
  const lit = new Set<number>();
  const heights = lines.map(l => 7 * (l.scale ?? 1));
  const total = heights.reduce((a, b) => a + b, 0) + (lines.length - 1) * 2;
  let y0 = Math.floor((ROWS - total) / 2);
  lines.forEach((l, li) => {
    const s = l.scale ?? 1;
    const w = l.text.length * 6 * s - s;
    const x0 = Math.floor((COLS - w) / 2);
    [...l.text].forEach((ch, ci) => {
      const g = G[ch] ?? G[" "];
      for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
        if (g[r][c] !== "#") continue;
        for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
          const x = x0 + (ci * 6 + c) * s + dx, y = y0 + r * s + dy;
          if (x >= 0 && x < COLS && y >= 0 && y < ROWS) lit.add(y * COLS + x);
        }
      }
    });
    y0 += heights[li] + 2;
  });
  return lit;
}

const clock = (s: number) => `Q4 ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const SCENES = (secs: number): Line[][] => [
  [{ text: "WOL 51  STM 54" }, { text: clock(secs) }],
  [{ text: "YOUR READ" }, { text: "B+", scale: 2 }],
  [{ text: "GOOD READS 14" }, { text: "TO FIX  3" }],
  [{ text: "DRILL READY" }, { text: "SKIP PASS" }],
];

export default function HeroBoard() {
  const reduce = useReducedMotion();
  const [scene, setScene] = useState(reduce ? 1 : 0);
  const [secs, setSecs] = useState(41);

  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setScene(s => (s + 1) % 4), 3400);
    return () => clearInterval(t);
  }, [reduce]);
  useEffect(() => {
    if (reduce || scene !== 0) return;
    const t = setInterval(() => setSecs(s => (s > 1 ? s - 1 : 41)), 1000);
    return () => clearInterval(t);
  }, [reduce, scene]);

  const lit = useMemo(() => render(SCENES(secs)[scene]), [scene, secs]);
  const label = ["Score: Wolves 51, Storm 54", "Your read: B plus", "Good reads 14, to fix 3", "Drill ready: skip pass"][scene];

  return (
    <div className="relative mx-auto w-full max-w-3xl rounded-[26px] bg-[#121212] p-3 shadow-lift ring-1 ring-black/10 dark:ring-white/10 sm:p-4" role="img" aria-label={`Scoreboard. ${label}`}>
      {/* Bezel screws */}
      {["left-2.5 top-2.5", "right-2.5 top-2.5", "left-2.5 bottom-2.5", "right-2.5 bottom-2.5"].map(p => (
        <span key={p} className={`absolute ${p} h-1.5 w-1.5 rounded-full bg-white/10`} />
      ))}
      <div className="rounded-[18px] bg-[#0a0a0a] px-3 py-4 sm:px-5 sm:py-6">
        <svg viewBox={`0 0 ${COLS * 10} ${ROWS * 10}`} className="block w-full">
          {Array.from({ length: COLS * ROWS }, (_, i) => {
            const x = i % COLS, y = Math.floor(i / COLS);
            const on = lit.has(i);
            return (
              <circle key={i} cx={x * 10 + 5} cy={y * 10 + 5} r={3.6}
                fill={on ? "#ffb23f" : "#ffb23f"} fillOpacity={on ? 1 : 0.07}
                // Column wipe: each column changes a beat after the one before.
                style={{ transition: reduce ? "none" : `fill-opacity 140ms linear ${x * 7}ms` }} />
            );
          })}
        </svg>
      </div>
    </div>
  );
}
