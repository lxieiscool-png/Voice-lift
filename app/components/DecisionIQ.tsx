"use client";

import { useState } from "react";
import type { Profile, Review, PlayerDecision, GameReport, ChunkSummary, PlayerStat, TeamComparison } from "../lib/types";
import { gradeClass, formatTime, formatDate, TEAM_PALETTE, jerseyColor } from "../lib/decisioniq-helpers";

// ─── Parsers ──────────────────────────────────────────────────────────────────

function extractGrade(text: string) {
  return text.match(/(?:Overall\s+)?Decision\s+Grade:\s*([A-F][+-]?)/i)?.[1] ?? "N/A";
}

function parsePlayerBlocks(text: string): PlayerDecision[] {
  return text.split(/===\s*PLAYER\s*===/i).slice(1).map((block) => {
    const clean = block.replace(/===\s*END\s*===/i, "").trim();
    const field   = (l: string) => clean.match(new RegExp(`^${l}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";
    const section = (l: string) => clean.match(new RegExp(`${l}:\\s*([\\s\\S]*?)(?=\\n[A-Z][\\w ]+:|===|$)`, "i"))?.[1]?.trim() ?? "";
    return {
      player: field("Player"), role: field("Role"), action: field("Action"),
      sport: field("Sport"), grade: field("Decision Grade"),
      whatHappened: section("What Happened"), decisionRead: section("Decision Read"),
      bestAlternative: section("Best Alternative"), whyBetter: section("Why It Was Better"),
      otherOptions: section("Other Options").split("\n").map(l => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean),
      patternToImprove: section("Pattern To Improve"), practiceFocus: section("Practice Focus"),
    };
  }).filter(d => d.player || d.whatHappened);
}

function parseGameReport(text: string): GameReport {
  const extract     = (label: string) => text.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n[A-Z#][\\w &]+:|$)`, "i"))?.[1]?.trim() ?? "";
  const extractList = (label: string) => extract(label).split("\n").map(l => l.replace(/^[-•*\d.]\s*/, "").trim()).filter(Boolean);
  const playerStats: PlayerStat[] = extract("Player Stats")
    .split("\n").map(l => l.replace(/^[-•*]\s*/, "").trim())
    .filter(l => l && !l.toLowerCase().includes("no jersey") && !l.toLowerCase().includes("no players"))
    .map(l => ({ label: l.split("|")[0].replace(/\([^)]*\)/, "").trim() || l.slice(0, 20), raw: l }));
  return {
    overallGrade: extractGrade(text),
    gameSummary: extract("Game Summary"), periodBreakdown: extract("Period Breakdown"),
    foulPatterns: extract("Foul & Call Patterns"), decisionTrends: extract("Decision Trends"),
    strengths: extractList("Top 3 Strengths"), improvements: extractList("Top 3 Areas To Improve"),
    practiceFocus: extract("Game-Level Practice Focus"), playerStats,
    teamComparison: parseTeamComparison(text),
  };
}

function isEmptyGameReport(r: GameReport | null): boolean {
  if (!r) return true;
  const hasText = r.gameSummary || r.periodBreakdown || r.foulPatterns || r.decisionTrends || r.practiceFocus;
  return !hasText && r.strengths.length === 0 && r.improvements.length === 0 && r.playerStats.length === 0;
}

function parseTeamComparison(text: string): TeamComparison | null {
  const block = text.match(/Team Comparison:\s*([\s\S]*)$/i)?.[1];
  if (!block) return null;
  const teams = block.match(/Teams:\s*(.+?)\s+vs\.?\s+(.+)/i);
  if (!teams) return null;

  const scoreRaw  = block.match(/Score:\s*(.+)/i)?.[1]?.trim() ?? "";
  const winnerRaw = block.match(/Winner:\s*(.+)/i)?.[1]?.trim() ?? "";
  const stats = block.split("\n")
    .map(l => l.replace(/^[-•*]\s*/, "").trim())
    .map(l => l.match(/^(.+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map(m => ({ label: m[1].trim(), a: parseInt(m[2], 10), b: parseInt(m[3], 10) }));

  return {
    teamA: teams[1].trim(), teamB: teams[2].trim(),
    score:  /not visible|n\/a|unknown/i.test(scoreRaw) || !scoreRaw ? null : scoreRaw,
    winner: /unclear|n\/a|unknown/i.test(winnerRaw)    || !winnerRaw ? null : winnerRaw,
    stats,
    why: block.match(/Why:\s*([\s\S]*?)$/i)?.[1]?.trim() ?? "",
  };
}

// ─── Frame Extraction ─────────────────────────────────────────────────────────

type FrameWithTime = { dataUrl: string; timestamp: number };

async function extractFramesAdaptive(file: File): Promise<{ frames: FrameWithTime[]; mode: "clip" | "game" }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) { reject("Canvas failed."); return; }
    const url = URL.createObjectURL(file);
    video.src = url; video.muted = true; video.playsInline = true;
    video.onloadedmetadata = async () => {
      const duration = video.duration;
      const mode: "clip" | "game" = duration > 60 ? "game" : "clip";
      let timestamps: number[];
      if (mode === "clip") {
        // Sample densely so fast plays actually get captured — a decision happens
        // in ~2s, so 5s gaps miss the read entirely. Aim ~1 frame / 1.2s, cap 24.
        const cap = Math.min(duration, 30);
        const MAX_FRAMES = 24;
        const step = Math.max(cap / MAX_FRAMES, 0.6);
        timestamps = [];
        for (let t = 0.3; t < cap; t += step) timestamps.push(Number(t.toFixed(2)));
        if (timestamps.length === 0) timestamps = [Math.max(duration / 2, 0.3)];
      } else {
        timestamps = [];
        for (let t = 5; t < duration - 5; t += 30) timestamps.push(t);
        if (timestamps.length > 300) {
          const step = Math.floor(timestamps.length / 300);
          timestamps = timestamps.filter((_, i) => i % step === 0).slice(0, 300);
        }
      }
      canvas.width = 1280; canvas.height = 720;
      const frames: FrameWithTime[] = [];
      for (const time of timestamps) {
        await new Promise<void>((done) => {
          video.currentTime = time;
          video.onseeked = () => {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            frames.push({ dataUrl: canvas.toDataURL("image/jpeg", 0.85), timestamp: time });
            done();
          };
        });
      }
      URL.revokeObjectURL(url);
      resolve({ frames, mode });
    };
    video.onerror = () => reject("Video failed to load.");
  });
}

// ─── Share Card ───────────────────────────────────────────────────────────────

const GRADE_COLOR: Record<string, string> = {
  "A+": "#22c55e", "A": "#22c55e", "A-": "#4ade80",
  "B+": "#86efac", "B": "#86efac", "B-": "#bef264",
  "C+": "#fbbf24", "C": "#fbbf24", "C-": "#fb923c",
  "D+": "#f97316", "D": "#f97316", "D-": "#ef4444",
  "F":  "#ef4444",
};

async function shareGradeCard(opts: {
  name: string; grade: string; sport: string; role?: string;
  headline: string; insight: string; format?: "landscape" | "story";
}) {
  const isStory = opts.format === "story";
  const W = isStory ? 1080 : 1600;
  const H = isStory ? 1920 : 840;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const gradeColor = GRADE_COLOR[opts.grade] ?? "#71717a";
  const F = isStory ? 2.2 : 2; // scale factor

  // Background
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  const grid = Math.round(40 * F);
  ctx.strokeStyle = "#18181b"; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  const pad   = Math.round(56 * F);
  const innerW = W - pad * 2;

  if (isStory) {
    // ── Story layout: centered, vertical ──
    const centerY = H * 0.38;

    // Big grade
    const gSize = 220;
    ctx.fillStyle = gradeColor + "22";
    ctx.beginPath(); ctx.roundRect(W/2 - gSize/2, centerY - gSize/2, gSize, gSize, 20); ctx.fill();
    ctx.font = "bold 120px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = gradeColor; ctx.textAlign = "center";
    ctx.fillText(opts.grade, W/2, centerY + 42);

    // Name
    ctx.font = "bold 56px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(opts.name || "Player", W/2, centerY + gSize/2 + 80);

    // Sport / role
    ctx.font = "36px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#71717a";
    ctx.fillText([opts.sport, opts.role].filter(Boolean).join("  ·  "), W/2, centerY + gSize/2 + 130);

    // Divider
    ctx.strokeStyle = "#27272a"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pad, centerY + gSize/2 + 170); ctx.lineTo(W - pad, centerY + gSize/2 + 170); ctx.stroke();

    // Headline
    const textY = centerY + gSize/2 + 230;
    ctx.font = "bold 30px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#a1a1aa"; ctx.textAlign = "left";
    ctx.fillText("WHAT HAPPENED", pad, textY);
    ctx.font = "34px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#e4e4e7";
    wrapText(ctx, opts.headline, pad, textY + 44, innerW, 44, 3);

    // Insight
    const ins = textY + 44 + 3 * 44 + 60;
    ctx.font = "bold 30px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#a1a1aa"; ctx.textAlign = "left";
    ctx.fillText("NEXT TIME", pad, ins);
    ctx.font = "34px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#e4e4e7";
    wrapText(ctx, opts.insight, pad, ins + 44, innerW, 44, 2);

    // Branding
    ctx.font = "bold 32px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#ffffff"; ctx.textAlign = "center";
    ctx.fillText("REEL", W/2, H - 80);
    ctx.font = "26px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#3f3f46";
    ctx.fillText("getreelapp.vercel.app", W/2, H - 40);

  } else {
    // ── Landscape layout ──
    const gradeX = pad, gradeY = pad;
    const gradeW = Math.round(96 * F), gradeH = Math.round(56 * F);
    ctx.fillStyle = gradeColor + "22";
    ctx.beginPath(); ctx.roundRect(gradeX, gradeY, gradeW, gradeH, 10); ctx.fill();
    ctx.font = `bold ${Math.round(36 * F)}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = gradeColor; ctx.textAlign = "center";
    ctx.fillText(opts.grade, gradeX + gradeW / 2, gradeY + gradeH - Math.round(13 * F));

    ctx.textAlign = "left";
    ctx.font = `bold ${Math.round(28 * F)}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(opts.name || "Player", gradeX + gradeW + Math.round(20 * F), gradeY + Math.round(30 * F));
    ctx.font = `${Math.round(14 * F)}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = "#71717a";
    ctx.fillText([opts.sport, opts.role].filter(Boolean).join("  ·  "), gradeX + gradeW + Math.round(20 * F), gradeY + Math.round(52 * F));

    const divY = Math.round(134 * F);
    ctx.strokeStyle = "#27272a"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, divY); ctx.lineTo(W - pad, divY); ctx.stroke();

    const s1Y = Math.round(168 * F);
    ctx.font = `bold ${Math.round(15 * F)}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = "#a1a1aa";
    ctx.fillText("WHAT HAPPENED", pad, s1Y);
    ctx.font = `${Math.round(16 * F)}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = "#e4e4e7";
    wrapText(ctx, opts.headline, pad, s1Y + Math.round(28 * F), innerW, Math.round(26 * F), 3);

    const s2Y = Math.round(300 * F);
    ctx.font = `bold ${Math.round(15 * F)}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = "#a1a1aa";
    ctx.fillText("NEXT TIME", pad, s2Y);
    ctx.font = `${Math.round(16 * F)}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = "#e4e4e7";
    wrapText(ctx, opts.insight, pad, s2Y + Math.round(28 * F), innerW, Math.round(26 * F), 2);

    ctx.font = `bold ${Math.round(15 * F)}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = "#ffffff"; ctx.textAlign = "right";
    ctx.fillText("REEL", W - pad, H - Math.round(28 * F));
    ctx.font = `${Math.round(13 * F)}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = "#3f3f46";
    ctx.fillText("getreelapp.vercel.app", W - pad, H - Math.round(8 * F));
  }

  // Border
  ctx.strokeStyle = "#27272a"; ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/png"));
  if (!blob) return;

  if (navigator.share && navigator.canShare?.({ files: [new File([blob], "grade.png", { type: "image/png" })] })) {
    await navigator.share({
      title: `${opts.name || "Player"} — ${opts.grade} | Reel`,
      text: `Check out my grade card on Reel`,
      files: [new File([blob], "reel-grade.png", { type: "image/png" })],
    }).catch(() => {});
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `reel-${(opts.name || "grade").toLowerCase().replace(/\s+/g, "-")}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines: number) {
  const words = text.split(" ");
  let line = "";
  let lineCount = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + lineCount * lineH);
      line = word; lineCount++;
      if (lineCount >= maxLines) { ctx.fillText(line + "…", x, y + lineCount * lineH); return; }
    } else { line = test; }
  }
  if (line) ctx.fillText(line, x, y + lineCount * lineH);
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function GradeBadge({ grade, large }: { grade: string; large?: boolean }) {
  return (
    <span className={`inline-flex items-center justify-center rounded-md font-bold tabular-nums ${gradeClass(grade, "bg")} ${gradeClass(grade, "text")} ${large ? "px-3 py-1 text-base" : "px-2 py-0.5 text-xs"}`}>
      {grade}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">{children}</p>;
}

function ProgressBar({ current, total, label }: { current: number; total: number; label: string }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-zinc-600"><span>{label}</span><span>{pct}%</span></div>
      <div className="h-px w-full bg-zinc-800">
        <div className="h-px bg-white transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Player Card ──────────────────────────────────────────────────────────────

const DECISION_FIELDS = [
  { key: "whatHappened"     as const, label: "What Happened"      },
  { key: "decisionRead"     as const, label: "Coach's Read"       },
  { key: "bestAlternative"  as const, label: "Next Time"          },
  { key: "whyBetter"        as const, label: "Why It Was Better"  },
  { key: "patternToImprove" as const, label: "Pattern To Improve" },
  { key: "practiceFocus"    as const, label: "Practice This Week" },
];

function PlayerCard({ decision, teamColor, defaultOpen = false }: {
  decision: PlayerDecision;
  teamColor: typeof TEAM_PALETTE[0];
  defaultOpen?: boolean;
}) {
  const [open,    setOpen]    = useState(defaultOpen);
  const [sharing, setSharing] = useState(false);

  async function handleShare(e: React.MouseEvent, format: "landscape" | "story" = "landscape") {
    e.stopPropagation();
    setSharing(true);
    await shareGradeCard({
      name: decision.player.replace(/\s*\([^)]*\)/, "").trim(),
      grade: decision.grade || "N/A",
      sport: decision.sport,
      role: decision.role,
      headline: decision.whatHappened,
      insight: decision.bestAlternative,
      format,
    });
    setSharing(false);
  }
  const grade       = decision.grade || "N/A";
  const displayTeam = decision.player.match(/\(([^)]+)\)/)?.[1] ?? null;

  return (
    <div className={`border border-zinc-800 bg-zinc-950 rounded-xl border-l-2 ${teamColor.border} overflow-hidden`}>
      <button onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <GradeBadge grade={grade} large />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-white">{decision.player || "Unknown Player"}</span>
          {displayTeam && (
            <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-zinc-800 text-zinc-400">{displayTeam}</span>
          )}
          <p className="text-xs text-zinc-600 truncate mt-0.5">{decision.role || decision.sport}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={e => handleShare(e, "landscape")} disabled={sharing}
            className="rounded-lg border border-zinc-800 px-2.5 py-1 text-[10px] font-semibold text-zinc-500 hover:text-white hover:border-zinc-600 transition-colors disabled:opacity-40">
            {sharing ? "…" : "Share"}
          </button>
          <span className="text-[10px] text-zinc-600">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-zinc-800 px-4 py-4 grid gap-3 sm:grid-cols-2">
          {decision.whatHappened && (
            <div className="rounded-lg bg-zinc-900 p-3">
              <SectionLabel>What Happened</SectionLabel>
              <p className="text-sm text-white leading-relaxed">{decision.whatHappened}</p>
            </div>
          )}
          {decision.bestAlternative && (
            <div className="rounded-lg bg-zinc-900 p-3">
              <SectionLabel>Next Time</SectionLabel>
              <p className="text-sm text-white leading-relaxed">{decision.bestAlternative}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlayerCardList({ decisions }: { decisions: PlayerDecision[] }) {
  return (
    <div className="space-y-2">
      {decisions.map((d, i) => (
        <PlayerCard key={i} decision={d}
          teamColor={jerseyColor(d.player)}
          defaultOpen={i === 0} />
      ))}
    </div>
  );
}

// ─── Game Report ──────────────────────────────────────────────────────────────

const GAME_SECTIONS = [
  { key: "gameSummary"     as const, label: "Game Summary"         },
  { key: "periodBreakdown" as const, label: "Period Breakdown"      },
  { key: "foulPatterns"    as const, label: "Foul & Call Patterns"  },
  { key: "decisionTrends"  as const, label: "Decision Trends"       },
  { key: "practiceFocus"   as const, label: "Practice This Week"    },
];

function GameReportCard({ report }: { report: GameReport }) {
  return (
    <div className="space-y-3">
      <div className={`inline-flex flex-col items-center rounded-lg px-5 py-2.5 ${gradeClass(report.overallGrade, "bg")} ${gradeClass(report.overallGrade, "text")}`}>
        <span className="text-[10px] font-semibold uppercase tracking-widest opacity-70">Overall Grade</span>
        <span className="text-3xl font-bold leading-tight">{report.overallGrade}</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {GAME_SECTIONS.map(({ key, label }) => {
          const val = report[key]; if (!val) return null;
          return (
            <div key={key} className="border border-zinc-800 rounded-lg p-3">
              <SectionLabel>{label}</SectionLabel>
              <p className="text-sm text-zinc-300 leading-relaxed">{val as string}</p>
            </div>
          );
        })}

        {report.strengths.length > 0 && (
          <div className="border border-zinc-800 rounded-lg p-3">
            <SectionLabel>Strengths</SectionLabel>
            <ul className="space-y-1.5">
              {report.strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                  <span className="text-emerald-600 shrink-0 mt-0.5">+</span>{s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {report.improvements.length > 0 && (
          <div className="border border-zinc-800 rounded-lg p-3">
            <SectionLabel>Work On</SectionLabel>
            <ul className="space-y-1.5">
              {report.improvements.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                  <span className="text-orange-600 shrink-0 mt-0.5">→</span>{s}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {report.teamComparison && <TeamComparisonPanel tc={report.teamComparison} />}
      {report.playerStats.length > 0 && <PlayerStatsPanel stats={report.playerStats} />}
    </div>
  );
}

// ─── Team Comparison (light score-panel style) ────────────────────────────────

function teamInitials(name: string) {
  return name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function TeamComparisonPanel({ tc }: { tc: TeamComparison }) {
  const aWon = tc.winner ? tc.winner.toLowerCase().includes(tc.teamA.toLowerCase()) || tc.teamA.toLowerCase().includes(tc.winner.toLowerCase()) : false;
  const bWon = tc.winner ? !aWon : false;
  const [scoreA, scoreB] = tc.score?.match(/(\d+)\s*[–\-:]\s*(\d+)/)?.slice(1) ?? [null, null];

  return (
    <div className="rounded-2xl bg-white p-5 shadow-lg">
      {/* Header: teams + score */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-bold text-zinc-600">
            {teamInitials(tc.teamA)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-zinc-900">{tc.teamA}</p>
            <p className="text-xs text-zinc-500">Home / Team A</p>
          </div>
        </div>

        <div className="shrink-0 text-center">
          {scoreA && scoreB ? (
            <p className="text-2xl font-black tracking-tight">
              <span className={aWon ? "text-zinc-900" : "text-zinc-400"}>{scoreA}</span>
              <span className="text-zinc-300"> – </span>
              <span className={bWon ? "text-zinc-900" : "text-zinc-400"}>{scoreB}</span>
            </p>
          ) : (
            <p className="text-xs font-semibold text-zinc-400">VS</p>
          )}
          {tc.winner && (
            <div className="mt-0.5 flex justify-center gap-1.5">
              <span className={`rounded px-1.5 text-[10px] font-bold ${aWon ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-500"}`}>{aWon ? "W" : "L"}</span>
              <span className={`rounded px-1.5 text-[10px] font-bold ${bWon ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-500"}`}>{bWon ? "W" : "L"}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 min-w-0 flex-row-reverse">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-bold text-zinc-600">
            {teamInitials(tc.teamB)}
          </div>
          <div className="min-w-0 text-right">
            <p className="truncate text-sm font-bold text-zinc-900">{tc.teamB}</p>
            <p className="text-xs text-zinc-500">Away / Team B</p>
          </div>
        </div>
      </div>

      {/* Stat bars */}
      {tc.stats.length > 0 && (
        <div className="mt-5 space-y-4">
          {tc.stats.map(({ label, a, b }, i) => {
            const total = a + b;
            const aPct  = total > 0 ? (a / total) * 100 : 50;
            return (
              <div key={i}>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="font-bold text-zinc-900">{a}</span>
                  <span className="font-semibold text-zinc-700">{label}</span>
                  <span className="font-bold text-zinc-900">{b}</span>
                </div>
                <div className="flex h-1.5 gap-1 overflow-hidden rounded-full">
                  <div className="rounded-full bg-emerald-600" style={{ width: `${aPct}%` }} />
                  <div className="rounded-full bg-red-600 flex-1" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Why */}
      {tc.why && (
        <div className="mt-5 rounded-xl bg-zinc-50 p-4">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-700">
            ✓ {tc.winner ? `Why ${tc.winner} won` : "What decided it"}
          </p>
          <p className="text-sm leading-relaxed text-zinc-600">{tc.why}</p>
        </div>
      )}
    </div>
  );
}

// ─── Player Stats (light "Highlights" style panel) ───────────────────────────

function parseStatLine(raw: string) {
  const jersey   = raw.match(/#(\d+)/)?.[1] ?? null;
  const team     = raw.match(/\(([^)]+)\)/)?.[1]?.trim() ?? null;
  const sharp    = parseInt(raw.match(/(\d+)\s*sharp/i)?.[1] ?? "0", 10);
  const costly   = parseInt(raw.match(/(\d+)\s*costly/i)?.[1] ?? "0", 10);
  const fouls    = parseInt(raw.match(/Fouls?:\s*(\d+)/i)?.[1] ?? "0", 10);
  const standout = raw.match(/Standout[^:]*:\s*(.+?)\s*$/i)?.[1]?.trim() ?? null;
  return { jersey, team, sharp, costly, fouls, standout };
}

function StatChip({ children, tone }: { children: React.ReactNode; tone: "green" | "red" | "amber" }) {
  const styles = {
    green: "bg-emerald-50 text-emerald-700",
    red:   "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-700",
  }[tone];
  return <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${styles}`}>{children}</span>;
}

function PlayerStatsPanel({ stats }: { stats: PlayerStat[] }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-lg">
      <h3 className="mb-3 text-base font-bold text-zinc-900">Player Stats</h3>
      <div className="space-y-2">
        {stats.map((p, i) => {
          const s = parseStatLine(p.raw);
          return (
            <div key={i} className="rounded-xl border border-zinc-200 p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-bold text-zinc-600">
                  {s.jersey ? `#${s.jersey}` : p.label.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-zinc-900">
                    {s.jersey ? `Player #${s.jersey}` : p.label}
                  </p>
                  {s.team && <p className="text-xs text-zinc-500">{s.team}</p>}
                </div>
              </div>
              {(s.sharp > 0 || s.costly > 0 || s.fouls > 0) && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {s.sharp  > 0 && <StatChip tone="green">{s.sharp} sharp</StatChip>}
                  {s.costly > 0 && <StatChip tone="red">{s.costly} costly</StatChip>}
                  {s.fouls  > 0 && <StatChip tone="amber">{s.fouls} {s.fouls === 1 ? "foul" : "fouls"}</StatChip>}
                </div>
              )}
              {s.standout && <p className="mt-2.5 text-xs leading-relaxed text-zinc-500">{s.standout}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Find My Player ───────────────────────────────────────────────────────────

function findMyPlayer(decisions: PlayerDecision[], jersey?: string, teamColor?: string): PlayerDecision | null {
  if (!decisions.length) return null;
  if (!jersey && !teamColor) return null;
  const j = jersey?.toLowerCase().replace(/^#/, "");
  const c = teamColor?.toLowerCase();
  // Score each player by how well they match jersey + color
  const scored = decisions.map(d => {
    const p = d.player.toLowerCase();
    let score = 0;
    if (j && p.includes(`#${j}`)) score += 3;
    if (j && p.includes(j)) score += 2;
    if (c && p.includes(c)) score += 1;
    return { d, score };
  });
  const best = scored.sort((a, b) => b.score - a.score)[0];
  return best.score > 0 ? best.d : null;
}

// ─── Analysis Loader ──────────────────────────────────────────────────────────

const ANALYSIS_STEPS = [
  { key: "extract",    label: "Extracting frames"      },
  { key: "analyzing",  label: "Reading players"         },
  { key: "segment",    label: "Analyzing segments"      },
  { key: "report",     label: "Building report"         },
];

function AnalysisLoader({ label, current, total }: { label: string; current: number; total: number }) {
  // Map the live progress label to a step index
  const stepIndex = label.toLowerCase().includes("extracting") ? 0
    : label.toLowerCase().includes("analyzing player") ? 1
    : label.toLowerCase().includes("segment") ? 2
    : label.toLowerCase().includes("report") || label.toLowerCase().includes("building") ? 3
    : 1;

  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="flex flex-col items-center justify-center py-10 gap-8">
      {/* Animated orb */}
      <div className="relative flex items-center justify-center">
        <div className="h-16 w-16 rounded-full border-2 border-zinc-800 animate-ping absolute opacity-20" />
        <div className="h-10 w-10 rounded-full bg-white/10 border border-zinc-700 flex items-center justify-center">
          <div className="h-3 w-3 rounded-full bg-white animate-pulse" />
        </div>
      </div>

      {/* Steps */}
      <div className="w-full space-y-2">
        {ANALYSIS_STEPS.map((step, i) => {
          const done    = i < stepIndex;
          const active  = i === stepIndex;
          const pending = i > stepIndex;
          return (
            <div key={step.key} className={`flex items-center gap-3 rounded-lg px-4 py-2.5 transition-all ${active ? "border border-zinc-700 bg-zinc-900" : "opacity-30"}`}>
              <div className={`h-4 w-4 shrink-0 rounded-full flex items-center justify-center text-[9px] font-bold transition-all ${
                done ? "bg-white text-black" : active ? "border border-white" : "border border-zinc-700"
              }`}>
                {done ? "✓" : active ? <span className="animate-pulse">●</span> : ""}
              </div>
              <span className={`text-sm ${active ? "text-white font-semibold" : pending ? "text-zinc-700" : "text-zinc-500"}`}>
                {step.label}
              </span>
              {active && total > 1 && (
                <span className="ml-auto text-xs text-zinc-600 tabular-nums">{pct}%</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Sub-label for segment progress */}
      {label && total > 1 && (
        <p className="text-xs text-zinc-600 text-center">{label}</p>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function DecisionIQ({ profile, reviews, onReviewsChange, userId, isPro, onShowUpgrade }: {
  profile: Profile; reviews: Review[]; onReviewsChange: (r: Review[]) => void;
  userId?: string; isPro?: boolean; onShowUpgrade?: () => void;
}) {
  const [inputTab,   setInputTab]   = useState<"file" | "youtube">("file");
  const [fileName,   setFileName]   = useState("");
  const [clipTitle,  setClipTitle]  = useState("");
  const [teamColor,  setTeamColor]  = useState("");
  const [videoUrl,   setVideoUrl]   = useState("");
  const [videoFile,  setVideoFile]  = useState<File | null>(null);
  const [ytUrl,      setYtUrl]      = useState("");
  const [ytError,    setYtError]    = useState("");
  const [sport,      setSport]      = useState("");
  const [loading,    setLoading]    = useState(false);
  const [progressLabel,   setProgressLabel]   = useState("");
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal,   setProgressTotal]   = useState(0);
  const [decisions,    setDecisions]    = useState<PlayerDecision[]>([]);
  const [gameReport,   setGameReport]   = useState<GameReport | null>(null);
  const [resultMode,   setResultMode]   = useState<"clip" | "game" | null>(null);
  const [expandedReview, setExpandedReview] = useState<number | null>(null);
  const [analyzeError, setAnalyzeError] = useState("");
  const [pendingRetry, setPendingRetry] = useState<(() => void) | null>(null);

  function saveReviews(r: Review[]) { onReviewsChange(r); localStorage.setItem("decisioniq-reviews", JSON.stringify(r)); }
  function deleteReview(id: string) { saveReviews(reviews.filter(r => r.id !== id)); setExpandedReview(null); }

  // Extract individual frames from storyboard sheets using canvas
  async function extractFramesFromSheets(sheets: string[], rows: number, cols: number, frameWidth: number, frameHeight: number, frameCount: number, maxFrames = 24): Promise<string[]> {
    const frames: string[] = [];
    const canvas = document.createElement("canvas");
    canvas.width = frameWidth;
    canvas.height = frameHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return frames;

    // Spread target frames across all sheets
    const totalFrames = Math.min(frameCount, sheets.length * rows * cols);
    const targetFrames = Math.min(maxFrames, totalFrames);
    const step = Math.max(1, Math.floor(totalFrames / targetFrames));

    let frameIdx = 0;
    for (const sheetDataUrl of sheets) {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = sheetDataUrl;
      }).catch(() => null);
      if (!img) continue;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (frameIdx % step === 0) {
            ctx.drawImage(img, col * frameWidth, row * frameHeight, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
            frames.push(canvas.toDataURL("image/jpeg", 0.85));
          }
          frameIdx++;
          if (frames.length >= targetFrames) break;
        }
        if (frames.length >= targetFrames) break;
      }
      if (frames.length >= targetFrames) break;
    }
    return frames;
  }

  async function analyzeYouTube() {
    if (!ytUrl.trim()) return;
    setYtError("");
    setLoading(true); setDecisions([]); setGameReport(null); setResultMode(null);
    setProgressCurrent(0); setProgressTotal(0);

    try {
      setProgressLabel("Loading YouTube video…");
      const res  = await fetch("/api/youtube-frames", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: ytUrl }),
      });
      const data = await res.json();

      if (data.error) { setYtError(data.error); setLoading(false); return; }

      setProgressLabel("Extracting frames from video…");
      const frames = await extractFramesFromSheets(
        data.sheets, data.rows, data.cols, data.frameWidth, data.frameHeight, data.frameCount,
        data.mode === "game" ? 72 : 24
      );

      if (frames.length === 0) {
        setYtError("Could not extract frames from this video.");
        setLoading(false); return;
      }

      const mode: "clip" | "game" = data.mode;
      const videoTitle = `YouTube — ${ytUrl}`;

      await runAnalysis(frames.map(f => ({ dataUrl: f, timestamp: 0 })), mode, videoTitle);
    } catch (err) {
      console.error(err);
      setYtError("Something went wrong. Try a different video.");
    }
    setLoading(false); setProgressLabel("");
  }

  async function runAnalysis(frames: { dataUrl: string; timestamp: number }[], mode: "clip" | "game", videoTitle: string) {
    if (mode === "clip") {
      setProgressLabel("Analyzing players…"); setProgressTotal(1);
      const res  = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sport: sport || profile.sport, frames: frames.map(f => f.dataUrl), mode: "clip", jersey: profile.jersey, teamColor }) });
      const data = await res.json().catch(() => ({}));
      if (data.error) throw new Error(data.error);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setProgressCurrent(1);
      const parsed        = parsePlayerBlocks(data.feedback ?? "");
      const detectedSport = sport || parsed.find(p => p.sport)?.sport || profile.sport || "Unknown";
      const myPlayer = findMyPlayer(parsed, profile.jersey, teamColor);
      setDecisions(parsed); setResultMode("clip");
      saveReviews([{ id: crypto.randomUUID(), fileName: videoTitle, sport: detectedSport, mode: "clip", grade: myPlayer?.grade ?? parsed[0]?.grade ?? "N/A", timestamp: Date.now(), decisions: parsed }, ...reviews]);
    } else {
      const CHUNK_SIZE = 6;
      const chunks: { dataUrl: string; timestamp: number }[][] = [];
      for (let i = 0; i < frames.length; i += CHUNK_SIZE) chunks.push(frames.slice(i, i + CHUNK_SIZE));
      setProgressTotal(chunks.length + 1);
      const chunkSummaries: ChunkSummary[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const start = formatTime(chunk[0].timestamp), end = formatTime(chunk[chunk.length - 1].timestamp);
        setProgressLabel(`Segment ${i + 1} of ${chunks.length}…`);
        const res  = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sport: sport || profile.sport, frames: chunk.map(f => f.dataUrl), mode: "game", chunkIndex: i, chunkStart: start, chunkEnd: end, jersey: profile.jersey, teamColor }) });
        const data = await res.json().catch(() => ({}));
        if (data.error) throw new Error(data.error);
        if (!res.ok) throw new Error(`Server error ${res.status} on segment ${i + 1}`);
        chunkSummaries.push({ index: i, start, end, text: data.feedback ?? "" }); setProgressCurrent(i + 1);
      }
      setProgressLabel("Building game report…");
      const synthRes  = await fetch("/api/synthesize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sport: sport || profile.sport, chunkSummaries }) });
      if (!synthRes.ok) throw new Error(`Server error ${synthRes.status} on synthesis`);
      const synthData = await synthRes.json();
      if (synthData.error) throw new Error(synthData.error);
      setProgressCurrent(chunks.length + 1);
      const report = parseGameReport(synthData.report ?? "");
      const detectedGameSport = sport || profile.sport || "Unknown";
      setGameReport(report); setResultMode("game");
      saveReviews([{ id: crypto.randomUUID(), fileName: videoTitle, sport: detectedGameSport, mode: "game", grade: report.overallGrade, timestamp: Date.now(), gameReport: report }, ...reviews]);
    }
  }

  async function analyzeVideo() {
    if (!videoFile) return;

    // Usage gate — check + increment before starting
    if (userId && !isPro) {
      const res  = await fetch("/api/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (res.status === 403) { onShowUpgrade?.(); return; }
    }

    setLoading(true); setDecisions([]); setGameReport(null); setResultMode(null);
    setAnalyzeError(""); setPendingRetry(null);
    setProgressCurrent(0); setProgressTotal(0);
    const doAnalyze = async () => {
      setLoading(true); setAnalyzeError(""); setPendingRetry(null);
      setProgressCurrent(0); setProgressTotal(0);
      try {
        setProgressLabel("Extracting frames…");
        const { frames, mode } = await extractFramesAdaptive(videoFile!);
        await runAnalysis(frames, mode, clipTitle.trim() || fileName || "Untitled");
      } catch (err) {
        console.error(err);
        const msg = err instanceof Error ? err.message : "Something went wrong.";
        const isRateLimit  = msg.includes("429") || msg.toLowerCase().includes("rate");
        const isNotSports  = msg.toLowerCase().includes("sports clip") || msg.toLowerCase().includes("can't analyze");
        setAnalyzeError(
          isNotSports  ? msg
          : isRateLimit ? "Too many requests — the AI is busy. Wait a moment and try again."
          : "Analysis failed. Check your connection and try again.");
        setPendingRetry(() => doAnalyze);
      }
      setLoading(false); setProgressLabel("");
    };
    await doAnalyze();
  }

  const overallGrade = resultMode === "game" ? gameReport?.overallGrade ?? "N/A" : decisions[0]?.grade ?? "N/A";

  return (
    <div className="space-y-5">

      {/* Upload + Results */}
      <div className="grid gap-5 lg:grid-cols-2">

        {/* Upload */}
        <div className="border border-zinc-800 bg-zinc-950 rounded-xl p-4 sm:p-5">
          <p className="mb-4 text-sm font-semibold text-white">Upload</p>

          {/* Tab switcher */}
          <div className="mb-4 flex gap-1 rounded-lg border border-zinc-800 bg-black p-0.5">
            {(["file", "youtube"] as const).map(tab => (
              <button key={tab} onClick={() => { setInputTab(tab); setYtError(""); }}
                className={`flex-1 rounded-md py-2 text-xs font-semibold transition-colors ${inputTab === tab ? "bg-white text-black" : "text-zinc-500 hover:text-white"}`}>
                {tab === "file" ? "Video File" : "YouTube Link"}
              </button>
            ))}
          </div>

          {inputTab === "file" ? (
            <>
              <label className="block cursor-pointer rounded-xl border-2 border-dashed border-zinc-800 p-8 text-center hover:border-zinc-600 active:border-zinc-500 transition-colors">
                <input type="file" accept="video/*" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0]; if (!file) return;
                  setVideoFile(file); setFileName(file.name); setClipTitle(""); setTeamColor("");
                  setVideoUrl(URL.createObjectURL(file));
                  setDecisions([]); setGameReport(null); setResultMode(null);
                }} />
                <p className="text-3xl mb-2">🎬</p>
                <p className="text-sm font-semibold text-zinc-300">Tap to choose video</p>
                <p className="mt-1 text-xs text-zinc-600">Clip or full game. Adapts automatically.</p>
              </label>
              {videoUrl && <video className="mt-4 w-full rounded-lg border border-zinc-800" src={videoUrl} controls />}
              {fileName && <p className="mt-2 text-xs text-zinc-500 truncate">{fileName}</p>}
              <p className="mt-3 text-xs text-zinc-600 text-center">🔒 Your video is private and only used for analysis — never shared or stored.</p>
            </>
          ) : (
            <div className="space-y-3">
              <input
                className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-base text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
                placeholder="Paste a YouTube link (video or Short)"
                value={ytUrl}
                onChange={e => { setYtUrl(e.target.value); setYtError(""); }}
              />
              <input
                className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-base text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
                placeholder={profile.sport ? `Sport (${profile.sport})` : "Sport (optional)"}
                value={sport}
                onChange={e => setSport(e.target.value)}
              />
              <button
                onClick={analyzeYouTube}
                disabled={loading || !ytUrl.trim()}
                className="w-full rounded-xl bg-white py-3.5 text-base font-bold text-black hover:bg-zinc-200 transition-colors disabled:opacity-40">
                {loading ? "Analyzing…" : "Analyze YouTube Video"}
              </button>
              {ytError && (
                <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3">
                  <p className="text-sm text-red-400">{ytError}</p>
                </div>
              )}
              <p className="text-xs text-zinc-600">Must be a public video — private, unlisted, or age-restricted videos won't work. For the sharpest analysis, uploading the actual video file is still best.</p>
            </div>
          )}

          {inputTab === "file" && (
            <div className="mt-4 space-y-3">
              {videoFile && (
                <>
                  <input
                    className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-base text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
                    placeholder="Name this clip (e.g. Playoff game vs Lincoln)"
                    value={clipTitle}
                    onChange={e => setClipTitle(e.target.value)}
                  />
                  <input
                    className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-base text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
                    placeholder={profile.jersey ? `Your jersey color this game (e.g. White, Blue) — you're #${profile.jersey}` : "Your jersey color this game (e.g. White, Blue, Red)"}
                    value={teamColor}
                    onChange={e => setTeamColor(e.target.value)}
                  />
                </>
              )}
              <input
                className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-base text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
                placeholder={profile.sport ? `Sport (${profile.sport})` : "Sport (optional)"}
                value={sport}
                onChange={e => setSport(e.target.value)}
              />
              <button
                onClick={analyzeVideo}
                disabled={loading || !videoFile}
                className="w-full rounded-xl bg-white py-4 text-sm font-bold text-black disabled:opacity-30 active:bg-zinc-200 transition-colors"
              >
                {loading ? "Analyzing…" : "Analyze Film"}
              </button>
            </div>
          )}
        </div>

        {/* Results */}
        <div className="border border-zinc-800 bg-zinc-950 rounded-xl p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-white">
              {resultMode === "game" ? "Game Report" : "Player Decisions"}
            </p>
            {resultMode && !loading && !(resultMode === "clip" && decisions.length === 0) && (
              <GradeBadge grade={overallGrade} large />
            )}
          </div>

          {loading && (
            <AnalysisLoader label={progressLabel} current={progressCurrent} total={progressTotal} />
          )}

          {!loading && analyzeError && (
            <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-red-900 bg-red-950/20 p-6 text-center">
              <p className="text-2xl">⚠️</p>
              <p className="text-sm text-red-300">{analyzeError}</p>
              {pendingRetry && (
                <button onClick={pendingRetry}
                  className="rounded-xl bg-white px-6 py-2.5 text-sm font-bold text-black hover:bg-zinc-100 transition-colors">
                  Try again
                </button>
              )}
            </div>
          )}

          {!loading && !analyzeError && !resultMode && (
            <div className="flex h-52 items-center justify-center rounded-lg border border-zinc-800">
              <p className="text-sm text-zinc-600">
                {profile.name ? `Ready when you are, ${profile.name.split(" ")[0]}.` : "Upload a clip or game to get started."}
              </p>
            </div>
          )}

          {!loading && ((resultMode === "clip" && decisions.length === 0) || (resultMode === "game" && isEmptyGameReport(gameReport))) && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 text-center px-6 py-10">
              <p className="text-3xl">🎥</p>
              <p className="text-base font-semibold text-white">This clip was a little too unclear to break down</p>
              <p className="text-sm text-zinc-400 max-w-sm leading-relaxed">
                Nothing's broken — the analysis ran fine, but the footage was too blurry, too far away, or too fast to read the plays confidently. We'd rather tell you that than make something up.
              </p>
              <p className="text-xs text-zinc-600 max-w-sm leading-relaxed">
                Try a clearer clip where the players and the ball are clearly visible — closer footage and steady framing work best.
              </p>
              <button onClick={() => {
                  setVideoFile(null); setVideoUrl(""); setFileName(""); setClipTitle(""); setTeamColor("");
                  setDecisions([]); setGameReport(null); setResultMode(null);
                }}
                className="mt-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-zinc-200 transition-colors">
                Try another clip
              </button>
            </div>
          )}
          {!loading && resultMode === "clip" && decisions.length > 0 && <PlayerCardList decisions={decisions} />}
          {!loading && resultMode === "game" && gameReport && !isEmptyGameReport(gameReport) && <GameReportCard report={gameReport} />}
        </div>
      </div>

    </div>
  );
}

// ─── Film Library (exported — rendered as its own top-level section) ───────────

export function FilmLibrary({ reviews, onReviewsChange }: {
  reviews: Review[];
  onReviewsChange: (r: Review[]) => void;
}) {
  const [expandedReview, setExpandedReview] = useState<number | null>(null);
  const [search,      setSearch]      = useState("");
  const [modeFilter,  setModeFilter]  = useState<"all" | "clip" | "game">("all");
  const [gradeFilter, setGradeFilter] = useState<"all" | "good" | "mid" | "poor">("all");
  const [sharing,     setSharing]     = useState<string | null>(null);
  const [renamingId,  setRenamingId]  = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  function saveReviews(r: Review[]) { onReviewsChange(r); localStorage.setItem("decisioniq-reviews", JSON.stringify(r)); }
  function deleteReview(id: string) { saveReviews(reviews.filter(r => r.id !== id)); setExpandedReview(null); }
  function startRename(review: Review, e: React.MouseEvent) { e.stopPropagation(); setRenamingId(review.id); setRenameValue(review.fileName); }
  function commitRename() {
    if (renamingId) {
      saveReviews(reviews.map(r => r.id === renamingId ? { ...r, fileName: renameValue.trim() || r.fileName } : r));
    }
    setRenamingId(null);
  }
  function onToggle(i: number) { setExpandedReview(expandedReview === i ? null : i); }
  function onDelete(id: string) { deleteReview(id); }

  const GRADE_NUM: Record<string, number> = {
    "A+": 13, "A": 12, "A-": 11, "B+": 10, "B": 9, "B-": 8,
    "C+": 7, "C": 6, "C-": 5, "D+": 4, "D": 3, "D-": 2, "F": 1,
  };

  const filtered = reviews.filter(r => {
    if (modeFilter !== "all" && r.mode !== modeFilter) return false;
    const v = GRADE_NUM[r.grade] ?? 0;
    if (gradeFilter === "good" && v < 9) return false;
    if (gradeFilter === "mid"  && (v < 5 || v >= 9)) return false;
    if (gradeFilter === "poor" && v >= 5) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.sport.toLowerCase().includes(q) && !r.fileName.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  async function handleShareReview(review: Review, e: React.MouseEvent) {
    e.stopPropagation();
    setSharing(review.id);
    const firstPlayer = review.decisions?.[0];
    await shareGradeCard({
      name: firstPlayer ? firstPlayer.player.replace(/\s*\([^)]*\)/, "").trim() : review.sport,
      grade: review.grade,
      sport: review.sport,
      role: firstPlayer?.role,
      headline: firstPlayer?.whatHappened ?? review.fileName,
      insight: firstPlayer?.bestAlternative ?? "Check full report on Reel.",
    });
    setSharing(null);
  }

  // Empty state — no reviews at all
  if (reviews.length === 0) {
    return (
      <div className="border border-zinc-800 bg-zinc-950 rounded-xl p-10 flex flex-col items-center justify-center text-center gap-4">
        <p className="text-4xl">🎬</p>
        <div>
          <p className="text-base font-semibold text-white mb-1">No film yet</p>
          <p className="text-sm text-zinc-500 leading-relaxed max-w-xs">
            Upload your first clip in DecisionIQ and it'll show up here with your grade, breakdown, and feedback.
          </p>
        </div>
        <a href="#" onClick={e => { e.preventDefault(); document.querySelector<HTMLButtonElement>("[data-module='decision']")?.click(); }}
          className="rounded-xl bg-white px-6 py-2.5 text-sm font-bold text-black hover:bg-zinc-100 transition-colors">
          Go to DecisionIQ
        </a>
      </div>
    );
  }

  return (
    <div className="border border-zinc-800 bg-zinc-950 rounded-xl p-5">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Film Library</p>
          <p className="text-xs text-zinc-600 mt-0.5">{reviews.length} review{reviews.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="mb-4 space-y-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by sport or file name…"
          className="w-full rounded-lg border border-zinc-800 bg-black px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
        />
        <div className="flex flex-wrap gap-2">
          {(["all", "clip", "game"] as const).map(f => (
            <button key={f} onClick={() => setModeFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${modeFilter === f ? "bg-white text-black" : "border border-zinc-800 text-zinc-500 hover:text-white"}`}>
              {f === "all" ? "All" : f === "clip" ? "Clips" : "Games"}
            </button>
          ))}
          <div className="w-px bg-zinc-800 mx-1 self-stretch" />
          {(["all", "good", "mid", "poor"] as const).map(f => (
            <button key={f} onClick={() => setGradeFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${gradeFilter === f ? "bg-white text-black" : "border border-zinc-800 text-zinc-500 hover:text-white"}`}>
              {f === "all" ? "Any grade" : f === "good" ? "B+ and up" : f === "mid" ? "C to B" : "Below C"}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-lg border border-zinc-800">
          <p className="text-sm text-zinc-600">No reviews match your filters.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((review) => {
            const originalIndex = reviews.indexOf(review);
            const isOpen = expandedReview === originalIndex;
            return (
              <div key={review.id} className="border border-zinc-800 rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Grade pill */}
                  <div className="shrink-0">
                    <GradeBadge grade={review.grade} large />
                  </div>

                  {/* Meta */}
                  {renamingId === review.id ? (
                    <div className="flex-1 min-w-0 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null); }}
                        className="flex-1 min-w-0 rounded-lg border border-zinc-700 bg-black px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-zinc-500"
                      />
                      <button onClick={commitRename} className="rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-semibold text-black">Save</button>
                    </div>
                  ) : (
                    <button onClick={() => onToggle(originalIndex)} className="flex-1 min-w-0 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-white truncate">{review.fileName || review.sport}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${review.mode === "game" ? "bg-zinc-800 text-zinc-400" : "bg-zinc-800 text-zinc-400"}`}>
                          {review.mode === "game" ? "Game" : "Clip"}
                        </span>
                        {review.mode === "clip" && review.decisions && (
                          <span className="text-[10px] text-zinc-600">{review.decisions.length} players</span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-600 mt-0.5 truncate capitalize">{review.sport} · {formatDate(review.timestamp)}</p>
                    </button>
                  )}

                  {/* Actions */}
                  {renamingId !== review.id && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={e => startRename(review, e)}
                        className="rounded-lg border border-zinc-800 px-2.5 py-1.5 text-[10px] font-semibold text-zinc-500 hover:text-white hover:border-zinc-600 transition-colors">
                        Rename
                      </button>
                      <button onClick={e => handleShareReview(review, e)} disabled={sharing === review.id}
                        className="rounded-lg border border-zinc-800 px-2.5 py-1.5 text-[10px] font-semibold text-zinc-500 hover:text-white hover:border-zinc-600 transition-colors disabled:opacity-40">
                        {sharing === review.id ? "…" : "Share"}
                      </button>
                      <button onClick={() => onToggle(originalIndex)}
                        className="rounded-lg border border-zinc-800 px-2.5 py-1.5 text-[10px] font-semibold text-zinc-500 hover:text-white hover:border-zinc-600 transition-colors">
                        {isOpen ? "Close" : "View"}
                      </button>
                      <button onClick={() => onDelete(review.id)}
                        className="rounded-lg border border-zinc-800 px-2.5 py-1.5 text-[10px] font-semibold text-zinc-500 hover:text-red-400 hover:border-red-900 transition-colors">
                        Del
                      </button>
                    </div>
                  )}
                </div>

                {isOpen && (
                  <div className="border-t border-zinc-800 p-4">
                    {review.mode === "clip" && review.decisions
                      ? <PlayerCardList decisions={review.decisions} />
                      : review.mode === "game" && review.gameReport
                      ? <GameReportCard report={review.gameReport} />
                      : <p className="text-xs text-zinc-600">No data saved for this review.</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
