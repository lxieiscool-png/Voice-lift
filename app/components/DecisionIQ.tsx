"use client";

import { useEffect, useRef, useState } from "react";
import { Clapperboard, Lock, AlertTriangle, VideoOff, Loader2 } from "lucide-react";
import type { Profile, Review, PlayerDecision, GameReport, ChunkSummary, PlayerStat, TeamComparison, Team } from "../lib/types";
import { gradeClass, formatTime, formatDate } from "../lib/decisioniq-helpers";
import { createClient } from "../lib/supabase/client";

function persistReview(userId: string | undefined, review: Review) {
  if (!userId) return;
  const supabase = createClient();
  supabase.from("reviews").insert({
    id: review.id, user_id: userId, file_name: review.fileName, sport: review.sport,
    mode: review.mode, grade: review.grade, created_at: new Date(review.timestamp).toISOString(),
    data: { decisions: review.decisions, gameReport: review.gameReport },
    team_id: review.teamId ?? null, opponent_name: review.opponentName ?? null,
    game_type: review.gameType ?? null, game_date: review.gameDate ?? null, location: review.location ?? null,
  }).then(({ error }) => { if (error) console.error("Failed to save review to account:", error.message); });
}

function deleteReviewRemote(userId: string | undefined, id: string) {
  if (!userId) return;
  const supabase = createClient();
  supabase.from("reviews").delete().eq("id", id).eq("user_id", userId)
    .then(({ error }) => { if (error) console.error("Failed to delete review from account:", error.message); });
}

function renameReviewRemote(userId: string | undefined, id: string, fileName: string) {
  if (!userId) return;
  const supabase = createClient();
  supabase.from("reviews").update({ file_name: fileName }).eq("id", id).eq("user_id", userId)
    .then(({ error }) => { if (error) console.error("Failed to rename review in account:", error.message); });
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

import { parsePlayerBlocks, parseGameReport, isEmptyGameReport } from "../lib/analysis/parsers";

// ─── Frame Extraction ─────────────────────────────────────────────────────────

type FrameWithTime = { dataUrl: string; timestamp: number };

async function extractFramesAdaptive(file: File, deep = false): Promise<{ frames: FrameWithTime[]; mode: "clip" | "game" }> {
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
      } else if (deep) {
        // Deep path (signed-in users, runs as a background job with up to
        // 45 min of budget instead of a synchronous request) — sample far
        // more densely since we're no longer racing a live progress bar.
        const GAME_MAX_FRAMES = 400;
        timestamps = [];
        for (let t = 5; t < duration - 5; t += 8) timestamps.push(t);
        if (timestamps.length > GAME_MAX_FRAMES) {
          const step = Math.floor(timestamps.length / GAME_MAX_FRAMES);
          timestamps = timestamps.filter((_, i) => i % step === 0).slice(0, GAME_MAX_FRAMES);
        }
      } else {
        // Cap at 72 frames (12 six-frame segments) — matches the YouTube ingestion
        // path. Without this, a long uploaded game could hit ~300 frames / ~50
        // segments, making a direct upload far slower and costlier to analyze
        // than pasting the same game as a YouTube link.
        const GAME_MAX_FRAMES = 72;
        timestamps = [];
        for (let t = 5; t < duration - 5; t += 30) timestamps.push(t);
        if (timestamps.length > GAME_MAX_FRAMES) {
          const step = Math.floor(timestamps.length / GAME_MAX_FRAMES);
          timestamps = timestamps.filter((_, i) => i % step === 0).slice(0, GAME_MAX_FRAMES);
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

function PlayerCard({ decision, defaultOpen = false }: {
  decision: PlayerDecision;
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
    <div className="border border-zinc-800 bg-zinc-950 rounded-xl overflow-hidden">
      <div role="button" tabIndex={0} onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); } }}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left">
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
      </div>

      {open && (
        <div className="border-t border-zinc-800 px-4 py-4 space-y-3">
          {decision.action && (
            <div className="rounded-lg bg-zinc-900 p-3">
              <SectionLabel>Action</SectionLabel>
              <p className="text-sm text-white leading-relaxed">{decision.action}</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {decision.whatHappened && (
              <div className="rounded-lg bg-zinc-900 p-3">
                <SectionLabel>What Happened</SectionLabel>
                <p className="text-sm text-white leading-relaxed">{decision.whatHappened}</p>
              </div>
            )}
            {decision.decisionRead && (
              <div className="rounded-lg bg-zinc-900 p-3">
                <SectionLabel>Decision Read</SectionLabel>
                <p className="text-sm text-white leading-relaxed">{decision.decisionRead}</p>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {decision.bestAlternative && (
              <div className="rounded-lg bg-zinc-900 p-3">
                <SectionLabel>Best Alternative</SectionLabel>
                <p className="text-sm text-white leading-relaxed">{decision.bestAlternative}</p>
              </div>
            )}
            {decision.whyBetter && (
              <div className="rounded-lg bg-zinc-900 p-3">
                <SectionLabel>Why It Was Better</SectionLabel>
                <p className="text-sm text-white leading-relaxed">{decision.whyBetter}</p>
              </div>
            )}
          </div>

          {decision.otherOptions.length > 0 && (
            <div className="rounded-lg bg-zinc-900 p-3">
              <SectionLabel>Other Options</SectionLabel>
              <ul className="space-y-1">
                {decision.otherOptions.map((opt, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-white leading-relaxed">
                    <span className="text-zinc-600 shrink-0">•</span>{opt}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {decision.patternToImprove && (
            <div className="rounded-lg bg-zinc-900 p-3">
              <SectionLabel>Pattern To Improve</SectionLabel>
              <p className="text-sm text-white leading-relaxed">{decision.patternToImprove}</p>
            </div>
          )}

          {decision.practiceFocus && (
            <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3">
              <SectionLabel>Practice Focus</SectionLabel>
              <p className="text-sm text-white leading-relaxed">{decision.practiceFocus}</p>
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
        <PlayerCard key={i} decision={d} defaultOpen={i === 0} />
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

function playerInitials(label: string) {
  return label.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
}

function GameResultsView({ report, onClose }: { report: GameReport; onClose: () => void }) {
  const [focus, setFocus] = useState<PlayerStat | null>(null);
  const tc = report.teamComparison ?? null;

  // Group tracked players into teams by their "(TEAM)" tag
  const groups = new Map<string, { name: string; players: PlayerStat[] }>();
  for (const p of report.playerStats) {
    const name = parseStatLine(p.raw).team?.trim() || "Unknown";
    const k = name.toLowerCase();
    if (!groups.has(k)) groups.set(k, { name, players: [] });
    groups.get(k)!.players.push(p);
  }
  const sorted = [...groups.values()].sort((a, b) => b.players.length - a.players.length);
  const teams  = sorted.slice(0, 2);
  const extras = sorted.slice(2).flatMap(g => g.players);
  if (teams.length > 0 && extras.length) teams[teams.length - 1].players.push(...extras);

  const focusStat = focus ? parseStatLine(focus.raw) : null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black">
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <button onClick={onClose}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors">
            ← New analysis
          </button>
          <p className="text-sm font-black text-white">Game Report</p>
          <div className={`rounded-lg px-3 py-1 text-base font-black ${gradeClass(report.overallGrade, "bg")} ${gradeClass(report.overallGrade, "text")}`}>
            {report.overallGrade}
          </div>
        </div>

        {/* Team comparison chart */}
        {tc ? <TeamComparisonPanel tc={tc} /> : (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
            <p className="text-sm text-zinc-500">Team comparison wasn't possible for this footage — not enough clearly visible team-level data (score, both teams on screen, etc.).</p>
          </div>
        )}

        {/* Two-team rosters */}
        {teams.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {teams.map((t, ti) => (
              <div key={ti} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-black capitalize text-white">{t.name}</p>
                  <span className="text-xs text-zinc-600">{t.players.length} tracked</span>
                </div>
                <div className="space-y-2">
                  {t.players.map((p, i) => {
                    const s = parseStatLine(p.raw);
                    return (
                      <button key={i} onClick={() => setFocus(p)}
                        className="flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-black px-3 py-2.5 text-left transition-colors hover:border-zinc-500">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-zinc-300">
                          {s.jersey ? `#${s.jersey}` : playerInitials(p.label)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-white">{p.label}</span>
                          <span className="block text-[11px] text-zinc-500">
                            {s.sharp > 0 && <span className="text-emerald-500">{s.sharp} sharp</span>}
                            {s.sharp > 0 && s.costly > 0 && <span> · </span>}
                            {s.costly > 0 && <span className="text-red-500">{s.costly} costly</span>}
                            {(s.sharp > 0 || s.costly > 0) && s.fouls > 0 && <span> · </span>}
                            {s.fouls > 0 && <span className="text-amber-500">{s.fouls} {s.fouls === 1 ? "foul" : "fouls"}</span>}
                            {s.sharp === 0 && s.costly === 0 && s.fouls === 0 && <span>tracked</span>}
                          </span>
                        </span>
                        <span className="text-zinc-600">›</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Coaching sections */}
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
      </div>

      {/* Player detail modal */}
      {focus && focusStat && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setFocus(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-950 p-6" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-zinc-800 text-lg font-black text-white">
                {focusStat.jersey ? `#${focusStat.jersey}` : playerInitials(focus.label)}
              </span>
              <div className="min-w-0">
                <p className="text-base font-black text-white">{focus.label}</p>
                {focusStat.team && <p className="text-xs capitalize text-zinc-500">{focusStat.team}</p>}
              </div>
            </div>
            <div className="mb-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-zinc-900 py-3">
                <p className="text-xl font-black text-emerald-500">{focusStat.sharp}</p>
                <p className="text-[10px] uppercase tracking-widest text-zinc-500">Sharp</p>
              </div>
              <div className="rounded-xl bg-zinc-900 py-3">
                <p className="text-xl font-black text-red-500">{focusStat.costly}</p>
                <p className="text-[10px] uppercase tracking-widest text-zinc-500">Costly</p>
              </div>
              <div className="rounded-xl bg-zinc-900 py-3">
                <p className="text-xl font-black text-amber-500">{focusStat.fouls}</p>
                <p className="text-[10px] uppercase tracking-widest text-zinc-500">Fouls</p>
              </div>
            </div>
            {focusStat.standout && (
              <div className="mb-4 rounded-xl bg-zinc-900 p-3">
                <p className="mb-1 text-[10px] uppercase tracking-widest text-zinc-500">Standout moment</p>
                <p className="text-sm leading-relaxed text-zinc-300">{focusStat.standout}</p>
              </div>
            )}
            <button onClick={() => setFocus(null)} className="w-full rounded-xl bg-white py-2.5 text-sm font-bold text-black">Close</button>
          </div>
        </div>
      )}
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
  const [teamColor,  setTeamColor]  = useState(profile.teamColor || "");
  const [teamsNote,  setTeamsNote]  = useState("");
  const [videoUrl,   setVideoUrl]   = useState("");
  const [videoFile,  setVideoFile]  = useState<File | null>(null);
  const [ytUrl,      setYtUrl]      = useState("");
  const [ytError,    setYtError]    = useState("");
  const [sport,      setSport]      = useState("");
  const [loading,    setLoading]    = useState(false);
  const [myTeams,       setMyTeams]       = useState<Team[]>([]);
  const [linkedTeamId,  setLinkedTeamId]  = useState("");
  const [opponentName,  setOpponentName]  = useState("");
  const [gameType,      setGameType]      = useState("Game");
  const [gameDate,      setGameDate]      = useState("");

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    supabase.from("teams").select("*").eq("coach_user_id", userId).order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!data) return;
        setMyTeams(data.map((r: any) => ({
          id: r.id, name: r.name, city: r.city, state: r.state, season: r.season,
          gender: r.gender, ageGroup: r.age_group, level: r.level, sport: r.sport,
          coachUserId: r.coach_user_id, isPublic: r.is_public, slug: r.slug,
          createdAt: new Date(r.created_at).getTime(),
        })));
      });
  }, [userId]);
  const [progressLabel,   setProgressLabel]   = useState("");
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal,   setProgressTotal]   = useState(0);
  const [decisions,    setDecisions]    = useState<PlayerDecision[]>([]);
  const [gameReport,   setGameReport]   = useState<GameReport | null>(null);
  const [resultMode,   setResultMode]   = useState<"clip" | "game" | null>(null);
  const [expandedReview, setExpandedReview] = useState<number | null>(null);
  const [analyzeError, setAnalyzeError] = useState("");
  const [pendingRetry, setPendingRetry] = useState<(() => void) | null>(null);
  const [jobStarted,   setJobStarted]   = useState(false);

  function saveReviews(r: Review[]) { onReviewsChange(r); localStorage.setItem("decisioniq-reviews", JSON.stringify(r)); }
  function deleteReview(id: string) { saveReviews(reviews.filter(r => r.id !== id)); setExpandedReview(null); deleteReviewRemote(userId, id); }

  // Extract individual frames from storyboard sheets using canvas
  async function extractFramesFromSheets(sheets: string[], rows: number, cols: number, frameWidth: number, frameHeight: number, frameCount: number, maxFrames = 24, intervalMs = 5000): Promise<FrameWithTime[]> {
    const frames: FrameWithTime[] = [];
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
            // Each storyboard frame represents a fixed interval of the video —
            // frameIdx * interval gives the real timestamp this frame was taken
            // at, instead of the placeholder 0 every YouTube-sourced frame used
            // to get, which broke segment time labels ("0:00–0:00" for every
            // segment of a game analyzed from a YouTube link).
            frames.push({ dataUrl: canvas.toDataURL("image/jpeg", 0.85), timestamp: (frameIdx * intervalMs) / 1000 });
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

  async function analyzeYouTube(lenient = false) {
    if (!ytUrl.trim()) return;
    setYtError("");
    setLoading(true); setDecisions([]); setGameReport(null); setResultMode(null); setJobStarted(false);
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
        data.mode === "game" ? (userId ? 400 : 72) : 24, data.interval
      );

      if (frames.length === 0) {
        setYtError("Could not extract frames from this video.");
        setLoading(false); return;
      }

      const mode: "clip" | "game" = data.mode;
      const videoTitle = `YouTube — ${ytUrl}`;

      await runAnalysis(frames, mode, videoTitle, lenient);
    } catch (err) {
      console.error(err);
      setYtError("Something went wrong. Try a different video.");
    }
    setLoading(false); setProgressLabel("");
  }

  async function runAnalysis(frames: { dataUrl: string; timestamp: number }[], mode: "clip" | "game", videoTitle: string, lenient = false) {
    if (mode === "clip") {
      setProgressLabel("Analyzing players…"); setProgressTotal(1);
      const res  = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sport: sport || profile.sport, frames: frames.map(f => f.dataUrl), mode: "clip", jersey: profile.jersey, teamColor, teamsNote, lenient }) });
      const data = await res.json().catch(() => ({}));
      if (data.error) throw new Error(data.error);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setProgressCurrent(1);
      const parsed        = parsePlayerBlocks(data.feedback ?? "");
      const detectedSport = sport || parsed.find(p => p.sport)?.sport || profile.sport || "Unknown";
      const myPlayer = findMyPlayer(parsed, profile.jersey, teamColor);
      setDecisions(parsed); setResultMode("clip");
      const clipReview: Review = {
        id: crypto.randomUUID(), fileName: videoTitle, sport: detectedSport, mode: "clip",
        grade: myPlayer?.grade ?? parsed[0]?.grade ?? "N/A", timestamp: Date.now(), decisions: parsed,
        teamId: linkedTeamId || null, opponentName: opponentName.trim() || null,
        gameType: linkedTeamId ? gameType : null, gameDate: linkedTeamId && gameDate ? gameDate : null,
      };
      saveReviews([clipReview, ...reviews]);
      persistReview(userId, clipReview);
    } else if (userId) {
      // Signed-in users get the deep background job — it can run far longer
      // than a request/response cycle allows (up to 45 min), and survives
      // closing this tab. Guests (no account to attach a job to) fall
      // through to the synchronous path below instead.
      await runBackgroundGameJob(frames, videoTitle, lenient);
    } else {
      const CHUNK_SIZE = 6;
      const CONCURRENCY = 4;
      const chunks: { dataUrl: string; timestamp: number }[][] = [];
      for (let i = 0; i < frames.length; i += CHUNK_SIZE) chunks.push(frames.slice(i, i + CHUNK_SIZE));
      setProgressTotal(chunks.length + 1);
      const chunkSummaries: ChunkSummary[] = new Array(chunks.length);
      let completed = 0;
      let nextIndex = 0;
      async function analyzeChunk(i: number, attempt = 0): Promise<void> {
        const chunk = chunks[i];
        const start = formatTime(chunk[0].timestamp), end = formatTime(chunk[chunk.length - 1].timestamp);
        const res  = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sport: sport || profile.sport, frames: chunk.map(f => f.dataUrl), mode: "game", chunkIndex: i, chunkStart: start, chunkEnd: end, jersey: profile.jersey, teamColor, teamsNote, lenient }) });
        const data = await res.json().catch(() => ({}));
        // Concurrent segment requests can trip the OpenAI rate limit — back off and retry
        // a couple times before giving up, rather than failing the whole game report.
        if (res.status === 429 && attempt < 2) {
          await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
          return analyzeChunk(i, attempt + 1);
        }
        if (data.error) throw new Error(data.error);
        if (!res.ok) throw new Error(`Server error ${res.status} on segment ${i + 1}`);
        chunkSummaries[i] = { index: i, start, end, text: data.feedback ?? "" };
        completed++;
        setProgressCurrent(completed);
        setProgressLabel(`Segment ${completed} of ${chunks.length}…`);
      }
      async function worker() {
        while (nextIndex < chunks.length) {
          const i = nextIndex++;
          await analyzeChunk(i);
        }
      }
      setProgressLabel(`Analyzing ${chunks.length} segments…`);
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
      setProgressLabel("Building game report…");
      const synthRes  = await fetch("/api/synthesize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sport: sport || profile.sport, chunkSummaries, teamsNote, jersey: profile.jersey, teamColor }) });
      if (!synthRes.ok) throw new Error(`Server error ${synthRes.status} on synthesis`);
      const synthData = await synthRes.json();
      if (synthData.error) throw new Error(synthData.error);
      setProgressCurrent(chunks.length + 1);
      const report = parseGameReport(synthData.report ?? "");
      const detectedGameSport = sport || profile.sport || "Unknown";
      setGameReport(report); setResultMode("game");
      // Library tracks YOUR grade when the report identified you, not the whole game's
      const myGrade = (synthData.report ?? "").match(/Your Grade:\s*([A-F][+-]?)/i)?.[1];
      const gameReview: Review = {
        id: crypto.randomUUID(), fileName: videoTitle, sport: detectedGameSport, mode: "game",
        grade: myGrade ?? report.overallGrade, timestamp: Date.now(), gameReport: report,
        teamId: linkedTeamId || null, opponentName: opponentName.trim() || null,
        gameType: linkedTeamId ? gameType : null, gameDate: linkedTeamId && gameDate ? gameDate : null,
      };
      saveReviews([gameReview, ...reviews]);
      persistReview(userId, gameReview);
    }
  }

  async function runBackgroundGameJob(frames: { dataUrl: string; timestamp: number }[], videoTitle: string, lenient: boolean) {
    setProgressLabel("Starting background analysis…"); setProgressTotal(frames.length);
    const detectedGameSport = sport || profile.sport || "Unknown";
    const startRes = await fetch("/api/jobs/start", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId, fileName: videoTitle, sport: detectedGameSport,
        teamId: linkedTeamId || null, opponentName: opponentName.trim() || null,
        gameType: linkedTeamId ? gameType : null, gameDate: linkedTeamId && gameDate ? gameDate : null,
      }),
    });
    const startData = await startRes.json().catch(() => ({}));
    if (startData.error) throw new Error(startData.error);
    if (!startRes.ok) throw new Error(`Server error ${startRes.status} starting job`);
    const jobId: string = startData.jobId;

    const UPLOAD_CONCURRENCY = 6;
    let uploaded = 0;
    let nextIndex = 0;
    async function uploadOne(i: number) {
      const res = await fetch(`/api/jobs/${jobId}/frame`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: i, dataUrl: frames[i].dataUrl }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status} uploading frame ${i + 1}`);
      uploaded++;
      setProgressCurrent(uploaded);
      setProgressLabel(`Uploading frame ${uploaded} of ${frames.length}…`);
    }
    async function uploadWorker() {
      while (nextIndex < frames.length) {
        const i = nextIndex++;
        await uploadOne(i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, frames.length) }, uploadWorker));

    setProgressLabel("Queuing analysis…");
    const finalizeRes = await fetch(`/api/jobs/${jobId}/finalize`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId, frameCount: frames.length, timestamps: frames.map(f => f.timestamp),
        jersey: profile.jersey, teamColor, teamsNote, lenient,
      }),
    });
    const finalizeData = await finalizeRes.json().catch(() => ({}));
    if (finalizeData.error) throw new Error(finalizeData.error);
    if (!finalizeRes.ok) throw new Error(`Server error ${finalizeRes.status} queuing analysis`);

    setJobStarted(true);
  }

  async function analyzeVideo(lenient = false) {
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

    setLoading(true); setDecisions([]); setGameReport(null); setResultMode(null); setJobStarted(false);
    setAnalyzeError(""); setPendingRetry(null);
    setProgressCurrent(0); setProgressTotal(0);
    const doAnalyze = async () => {
      setLoading(true); setAnalyzeError(""); setPendingRetry(null);
      setProgressCurrent(0); setProgressTotal(0);
      try {
        setProgressLabel("Extracting frames…");
        const { frames, mode } = await extractFramesAdaptive(videoFile!, !!userId);
        await runAnalysis(frames, mode, clipTitle.trim() || fileName || "Untitled", lenient);
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
        <div className="rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/60 to-zinc-950 p-4 sm:p-5">
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
              <label className="group block cursor-pointer rounded-2xl border-2 border-dashed border-zinc-800 bg-gradient-to-b from-zinc-900/30 to-transparent p-8 text-center transition-all hover:border-zinc-500 hover:from-zinc-900/60 active:scale-[0.99]">
                <input type="file" accept="video/*" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0]; if (!file) return;
                  setVideoFile(file); setFileName(file.name); setClipTitle(""); setTeamColor(profile.teamColor || "");
                  setVideoUrl(URL.createObjectURL(file));
                  setDecisions([]); setGameReport(null); setResultMode(null);
                }} />
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-800/80 transition-transform group-hover:scale-110"><Clapperboard className="h-6 w-6 text-zinc-300" strokeWidth={1.75} /></div>
                <p className="text-sm font-bold text-white">Tap to choose video</p>
                <p className="mt-1 text-xs text-zinc-600">Clip or full game — adapts automatically</p>
              </label>
              {videoUrl && <video className="mt-4 w-full rounded-lg border border-zinc-800" src={videoUrl} controls />}
              {fileName && <p className="mt-2 text-xs text-zinc-500 truncate">{fileName}</p>}
              <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-zinc-600 text-center"><Lock className="h-3 w-3" strokeWidth={2} /> Your video is private and only used for analysis — never shared or stored.</p>
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
                onClick={() => analyzeYouTube()}
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
                  <input
                    className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-base text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
                    placeholder="Describe the teams if jerseys are mixed (e.g. 'my team: white + blue pinnies, them: all black')"
                    value={teamsNote}
                    onChange={e => setTeamsNote(e.target.value)}
                  />
                  {myTeams.length > 0 && (
                    <div className="rounded-xl border border-zinc-800 bg-black/40 p-3 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Attach to a team (optional)</p>
                      <select
                        className="w-full rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                        value={linkedTeamId}
                        onChange={e => setLinkedTeamId(e.target.value)}>
                        <option value="">Don't attach to a team</option>
                        {myTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      {linkedTeamId && (
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            className="rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                            placeholder="Opponent"
                            value={opponentName}
                            onChange={e => setOpponentName(e.target.value)}
                          />
                          <select
                            className="rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                            value={gameType}
                            onChange={e => setGameType(e.target.value)}>
                            <option value="Game">Game</option>
                            <option value="Practice">Practice</option>
                            <option value="Scrimmage">Scrimmage</option>
                          </select>
                          <input type="date"
                            className="col-span-2 rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                            value={gameDate}
                            onChange={e => setGameDate(e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
              <input
                className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-base text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
                placeholder={profile.sport ? `Sport (${profile.sport})` : "Sport (optional)"}
                value={sport}
                onChange={e => setSport(e.target.value)}
              />
              <button
                onClick={() => analyzeVideo()}
                disabled={loading || !videoFile}
                className="w-full rounded-xl bg-white py-4 text-sm font-bold text-black disabled:opacity-30 active:bg-zinc-200 transition-colors"
              >
                {loading ? "Analyzing…" : "Analyze Film"}
              </button>
            </div>
          )}
        </div>

        {/* Results */}
        <div className="rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/60 to-zinc-950 p-4 sm:p-5">
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

          {!loading && jobStarted && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-emerald-900/60 bg-emerald-950/20 p-8 text-center">
              <Clapperboard className="h-8 w-8 text-emerald-400" strokeWidth={1.5} />
              <p className="text-base font-semibold text-white">Analysis started</p>
              <p className="text-sm text-zinc-400 max-w-sm leading-relaxed">
                This runs in the background and can take up to 45 minutes for a full game — feel free to close this tab. Check the Library for progress, and it'll show up there as a finished review when it's done.
              </p>
            </div>
          )}

          {!loading && !jobStarted && analyzeError && (
            <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-red-900 bg-red-950/20 p-6 text-center">
              <AlertTriangle className="h-7 w-7 text-red-400" strokeWidth={1.75} />
              <p className="text-sm text-red-300">{analyzeError}</p>
              {pendingRetry && (
                <button onClick={pendingRetry}
                  className="rounded-xl bg-white px-6 py-2.5 text-sm font-bold text-black hover:bg-zinc-100 transition-colors">
                  Try again
                </button>
              )}
            </div>
          )}

          {!loading && !analyzeError && !resultMode && !jobStarted && (
            <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/40 to-zinc-950 p-5">
              <p className="mb-4 text-center text-sm text-zinc-500">
                {profile.name ? `Ready when you are, ${profile.name.split(" ")[0]} — here's what a review looks like:` : "Upload a clip and every player gets a card like this:"}
              </p>
              {/* Ghost preview of a graded player card */}
              <div className="pointer-events-none select-none space-y-2 opacity-60">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500 text-lg font-black text-white">A-</div>
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-white">White #23 Point Guard</div>
                      <div className="text-xs text-zinc-600">Drive-and-kick read</div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg bg-zinc-900 p-2.5">
                      <div className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1">What Happened</div>
                      <div className="text-xs text-zinc-400">Drew two defenders on the drive, kicked to the open corner.</div>
                    </div>
                    <div className="rounded-lg bg-zinc-900 p-2.5">
                      <div className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1">Next Time</div>
                      <div className="text-xs text-zinc-400">Same read, half a beat earlier — before help commits.</div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400 text-sm font-black text-black">C+</div>
                  <div className="text-sm font-semibold text-zinc-400">Blue #11 Help Defender</div>
                </div>
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-zinc-950 to-transparent" />
            </div>
          )}

          {!loading && ((resultMode === "clip" && decisions.length === 0) || (resultMode === "game" && isEmptyGameReport(gameReport))) && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 text-center px-6 py-10">
              <VideoOff className="h-9 w-9 text-zinc-600" strokeWidth={1.5} />
              <p className="text-base font-semibold text-white">This clip was a little too unclear to break down</p>
              <p className="text-sm text-zinc-400 max-w-sm leading-relaxed">
                Nothing's broken — the analysis ran fine, but the footage was too blurry, too far away, or too fast to read the plays confidently. We'd rather tell you that than make something up.
              </p>
              <p className="text-xs text-zinc-600 max-w-sm leading-relaxed">
                Try a clearer clip where the players and the ball are clearly visible — closer footage and steady framing work best.
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <button onClick={() => (videoFile ? analyzeVideo(true) : analyzeYouTube(true))}
                  className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-zinc-200 transition-colors">
                  Analyze anyway
                </button>
                <button onClick={() => {
                    setVideoFile(null); setVideoUrl(""); setFileName(""); setClipTitle(""); setTeamColor("");
                    setDecisions([]); setGameReport(null); setResultMode(null);
                  }}
                  className="rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-semibold text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors">
                  Try another clip
                </button>
              </div>
              <p className="text-[11px] text-zinc-700">"Analyze anyway" gives a best-effort read — uncertain calls are marked low confidence.</p>
            </div>
          )}
          {!loading && resultMode === "clip" && decisions.length > 0 && <PlayerCardList decisions={decisions} />}
          {!loading && resultMode === "game" && gameReport && !isEmptyGameReport(gameReport) && (
            <GameResultsView report={gameReport}
              onClose={() => { setDecisions([]); setGameReport(null); setResultMode(null); }} />
          )}
        </div>
      </div>

    </div>
  );
}

// ─── Film Library (exported — rendered as its own top-level section) ───────────

type AnalysisJob = {
  id: string; status: "queued" | "processing" | "complete" | "failed";
  progress_current: number; progress_total: number; progress_label: string | null;
  file_name: string | null; sport: string | null; error: string | null; review_id: string | null;
};

export function FilmLibrary({ reviews, onReviewsChange, userId }: {
  reviews: Review[];
  onReviewsChange: (r: Review[]) => void;
  userId?: string;
}) {
  const [expandedReview, setExpandedReview] = useState<number | null>(null);
  const [search,      setSearch]      = useState("");
  const [modeFilter,  setModeFilter]  = useState<"all" | "clip" | "game">("all");
  const [gradeFilter, setGradeFilter] = useState<"all" | "good" | "mid" | "poor">("all");
  const [sharing,     setSharing]     = useState<string | null>(null);
  const [renamingId,  setRenamingId]  = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [myTeams,     setMyTeams]     = useState<{ id: string; name: string }[]>([]);
  const [jobs,        setJobs]        = useState<AnalysisJob[]>([]);
  const reviewsRef = useRef(reviews);
  reviewsRef.current = reviews;

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    let cancelled = false;

    async function poll() {
      const { data } = await supabase.from("analysis_jobs").select("*")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(10);
      if (cancelled || !data) return;
      setJobs(data as AnalysisJob[]);

      // A job that just finished has a review sitting in Supabase that this
      // component's local `reviews` state doesn't know about yet — pull it
      // in so the finished result shows up without a manual page reload.
      for (const job of data as AnalysisJob[]) {
        if (job.status === "complete" && job.review_id && !reviewsRef.current.some(r => r.id === job.review_id)) {
          const { data: row } = await supabase.from("reviews").select("*").eq("id", job.review_id).single();
          if (row && !reviewsRef.current.some(r => r.id === row.id)) {
            const mapped: Review = {
              id: row.id, fileName: row.file_name, sport: row.sport, mode: row.mode,
              grade: row.grade, timestamp: new Date(row.created_at).getTime(),
              teamId: row.team_id, opponentName: row.opponent_name, gameType: row.game_type,
              gameDate: row.game_date, location: row.location,
              ...(row.data || {}),
            };
            saveReviews([mapped, ...reviewsRef.current]);
          }
        }
      }
    }

    poll();
    const interval = setInterval(poll, 6000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    supabase.from("teams").select("id,name").eq("coach_user_id", userId).order("created_at", { ascending: false })
      .then(({ data }) => setMyTeams(data || []));
  }, [userId]);

  function linkReviewToTeam(id: string, teamId: string) {
    saveReviews(reviews.map(r => r.id === id ? { ...r, teamId: teamId || null } : r));
    if (userId) {
      const supabase = createClient();
      supabase.from("reviews").update({ team_id: teamId || null }).eq("id", id).eq("user_id", userId)
        .then(({ error }) => { if (error) console.error("Failed to link review to team:", error.message); });
    }
  }

  function saveReviews(r: Review[]) { onReviewsChange(r); localStorage.setItem("decisioniq-reviews", JSON.stringify(r)); }
  function deleteReview(id: string) { saveReviews(reviews.filter(r => r.id !== id)); setExpandedReview(null); deleteReviewRemote(userId, id); }
  function startRename(review: Review, e: React.MouseEvent) { e.stopPropagation(); setRenamingId(review.id); setRenameValue(review.fileName); }
  function commitRename() {
    if (renamingId) {
      const trimmed = renameValue.trim();
      saveReviews(reviews.map(r => r.id === renamingId ? { ...r, fileName: trimmed || r.fileName } : r));
      const original = reviews.find(r => r.id === renamingId);
      if (trimmed && original && trimmed !== original.fileName) renameReviewRemote(userId, renamingId, trimmed);
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

  const activeJobs = jobs.filter(j => j.status === "queued" || j.status === "processing");
  const failedJobs = jobs.filter(j => j.status === "failed");
  const jobsPanel = (activeJobs.length > 0 || failedJobs.length > 0) && (
    <div className="mb-4 space-y-2">
      {activeJobs.map(job => (
        <div key={job.id} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{job.file_name || "Untitled game"}</p>
            <p className="text-xs text-zinc-500">
              {job.progress_label || "Starting…"}
              {job.progress_total > 0 && ` — ${job.progress_current}/${job.progress_total}`}
            </p>
          </div>
        </div>
      ))}
      {failedJobs.map(job => (
        <div key={job.id} className="rounded-xl border border-red-900 bg-red-950/20 px-4 py-3">
          <p className="text-sm font-semibold text-white">{job.file_name || "Untitled game"} — analysis failed</p>
          <p className="mt-0.5 text-xs text-red-300">{job.error || "Something went wrong."}</p>
        </div>
      ))}
    </div>
  );

  // Empty state — no reviews at all (still shows in-progress jobs, if any)
  if (reviews.length === 0) {
    return (
      <div>
        {jobsPanel}
        <div className="rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/60 to-zinc-950 p-10 flex flex-col items-center justify-center text-center gap-4">
          <Clapperboard className="h-10 w-10 text-zinc-600" strokeWidth={1.5} />
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
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/60 to-zinc-950 p-5">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Film Library</p>
          <p className="text-xs text-zinc-600 mt-0.5">{reviews.length} review{reviews.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {jobsPanel}

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
                      {myTeams.length > 0 && (
                        <select
                          value={review.teamId || ""}
                          onClick={e => e.stopPropagation()}
                          onChange={e => linkReviewToTeam(review.id, e.target.value)}
                          className="rounded-lg border border-zinc-800 bg-black px-2 py-1.5 text-[10px] font-semibold text-zinc-500 hover:text-white hover:border-zinc-600 transition-colors focus:outline-none">
                          <option value="">No team</option>
                          {myTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      )}
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
                      ? <GameResultsView report={review.gameReport} onClose={() => onToggle(originalIndex)} />
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
