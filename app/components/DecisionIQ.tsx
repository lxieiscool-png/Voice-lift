"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Clapperboard, Dumbbell, Loader2, Lock, MoreVertical, Upload, Users, Video, VideoOff, X } from "lucide-react";
import type { Profile, Review, PlayerDecision, GameReport, ChunkSummary, TeamComparison, Team, PlayerBoxStat, PlayerVolleyStat } from "../lib/types";
import { gradeClass, formatTime, formatDate, gameResult, openDrillCheck, playedAt } from "../lib/decisioniq-helpers";
import { createClient } from "../lib/supabase/client";
import { TeamSectionHeader, GameCard, teamAvatarColor } from "./GameCards";
import { Button } from "./ui/button";
import { Segmented } from "./ui/segmented";

function persistReview(userId: string | undefined, review: Review) {
  if (!userId) return;
  const supabase = createClient();
  supabase.from("reviews").insert({
    id: review.id, user_id: userId, file_name: review.fileName, sport: review.sport,
    mode: review.mode, grade: review.grade, created_at: new Date(review.timestamp).toISOString(),
    data: { decisions: review.decisions, gameReport: review.gameReport, teamColor: review.teamColor ?? null },
    team_id: review.teamId ?? null, opponent_name: review.opponentName ?? null,
    game_type: review.gameType ?? null, game_date: review.gameDate ?? null, location: review.location ?? null,
    thumbnail_url: review.thumbnailUrl ?? null,
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

import { parsePlayerBlocks, parseGameReport, isEmptyGameReport, buildBoxScore, buildVolleyBoxScore, buildDecisionTimeline } from "../lib/analysis/parsers";
import { buildRosterView, type RosterPlayer, type RosterTeam } from "../lib/analysis/gameAccuracy";
import { StatTable, StatHeader, CoverageMeter, pctText, type StatCol } from "./ui/stat-table";
import FilmRoom, { youtubeIdFrom } from "./FilmRoom";

// ─── Thumbnail ────────────────────────────────────────────────────────────────

// Picks a representative frame (roughly a third of the way in — past any
// intro/tip-off dead air but before the video ends), downscales it, and uploads
// it to the public game-thumbnails bucket for Library/Teams card previews.
// Best-effort: any failure returns null and the caller carries on without a
// thumbnail rather than failing the whole analysis.
async function captureThumbnail(frames: { dataUrl: string; timestamp: number }[]): Promise<string | null> {
  try {
    if (!frames.length) return null;
    const source = frames[Math.floor(frames.length / 3)] ?? frames[0];
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = source.dataUrl;
    });
    const maxW = 640;
    const scale = Math.min(1, maxW / (img.width || maxW));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round((img.width || maxW) * scale);
    canvas.height = Math.round((img.height || maxW * 0.5625) * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);

    const res = await fetch("/api/thumbnail", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data.url ?? null;
  } catch {
    return null;
  }
}

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
      // Clip vs game cutoff: under 2 minutes is a clip (one deep pass, per-
      // player cards, burns a clip credit); longer is a game (segmented
      // background analysis, burns a game credit).
      const mode: "clip" | "game" = duration > 120 ? "game" : "clip";
      let timestamps: number[];
      if (mode === "clip") {
        // Short clips sample densely so fast plays actually get captured — a
        // decision happens in ~2s. Longer clips spread the same budget evenly
        // across the whole video (the /api/analyze cap is 32 frames/call).
        const cap = Math.min(duration, 120);
        const MAX_FRAMES = duration <= 30 ? 24 : 30;
        const step = Math.max(cap / MAX_FRAMES, 0.6);
        timestamps = [];
        for (let t = 0.3; t < cap; t += step) timestamps.push(Number(t.toFixed(2)));
        if (timestamps.length === 0) timestamps = [Math.max(duration / 2, 0.3)];
      } else if (deep) {
        // Deep path (signed-in users, runs as a background job with up to
        // 45 min of budget). Sample finer than before (every 5s), then
        // motion-filter during capture (below) to drop near-identical /
        // dead-time frames — so the frame budget is spent on active play
        // instead of timeouts and huddles. Cap candidates so seeking stays
        // bounded; kept frames are capped again after filtering.
        const CANDIDATE_CAP = 320;
        timestamps = [];
        for (let t = 5; t < duration - 5; t += 6) timestamps.push(t);
        if (timestamps.length > CANDIDATE_CAP) {
          const step = Math.floor(timestamps.length / CANDIDATE_CAP);
          timestamps = timestamps.filter((_, i) => i % step === 0).slice(0, CANDIDATE_CAP);
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
      // Clip mode ships every frame in ONE request and Vercel rejects bodies
      // over ~4.5MB, so clip frames trade a little resolution for headroom.
      // Game frames upload one per request, so they keep full 720p.
      if (mode === "clip") { canvas.width = 1152; canvas.height = 648; }
      else { canvas.width = 1280; canvas.height = 720; }
      const jpegQuality = mode === "clip" ? 0.7 : 0.85;

      // Cheap motion signature (tiny grayscale thumbnail) used only on the deep
      // path to skip frames that barely changed from the last kept one.
      const SIG_W = 32, SIG_H = 18;
      const MOTION_THRESHOLD = 9;  // mean per-pixel grayscale delta (0–255) to count as "changed"
      const MAX_GAP = 20;          // force-keep at least this often (s) so static stretches still get sampled
      const GAME_MAX_FRAMES = 240; // frame budget (was 400) — biggest lever on per-game cost; same model, so read quality per frame is unchanged
      const sigCanvas = document.createElement("canvas");
      sigCanvas.width = SIG_W; sigCanvas.height = SIG_H;
      const sigCtx = sigCanvas.getContext("2d", { willReadFrequently: true });
      const signature = (): number[] | null => {
        if (!sigCtx) return null;
        sigCtx.drawImage(video, 0, 0, SIG_W, SIG_H);
        const d = sigCtx.getImageData(0, 0, SIG_W, SIG_H).data;
        const g = new Array(SIG_W * SIG_H);
        for (let i = 0; i < g.length; i++) { const p = i * 4; g[i] = d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114; }
        return g;
      };
      const meanDiff = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };

      const frames: FrameWithTime[] = [];
      let lastSig: number[] | null = null;
      let lastKeptTime = -Infinity;
      for (const time of timestamps) {
        await new Promise<void>((done) => {
          video.currentTime = time;
          video.onseeked = () => {
            if (deep) {
              const sig = signature();
              const changed = !lastSig || !sig || meanDiff(sig, lastSig) > MOTION_THRESHOLD;
              const gap = time - lastKeptTime >= MAX_GAP;
              if (!changed && !gap) { done(); return; }
              lastSig = sig; lastKeptTime = time;
            }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            frames.push({ dataUrl: canvas.toDataURL("image/jpeg", jpegQuality), timestamp: time });
            done();
          };
        });
      }
      URL.revokeObjectURL(url);
      // Final safety cap so a very active game can't blow the frame budget.
      let out = frames;
      if (out.length > GAME_MAX_FRAMES) {
        const step = out.length / GAME_MAX_FRAMES;
        out = Array.from({ length: GAME_MAX_FRAMES }, (_, i) => frames[Math.floor(i * step)]);
      }
      // Clip payload budget: everything goes in one request and Vercel hard-
      // rejects bodies over ~4.5MB with a generic error the user can't act on.
      // Detail-heavy footage compresses worse, so if the total is still over
      // budget, thin frames evenly — a sparser clip analysis beats a failure.
      if (mode === "clip") {
        const BUDGET = 3_800_000;
        let total = out.reduce((s, f) => s + f.dataUrl.length, 0);
        while (total > BUDGET && out.length > 8) {
          out = out.filter((_, i) => i % 2 === 0);
          total = out.reduce((s, f) => s + f.dataUrl.length, 0);
        }
      }
      resolve({ frames: out, mode });
    };
    video.onerror = () => reject("Video failed to load.");
  });
}

// Screen capture: pull real frames straight from whatever the athlete is
// watching (a YouTube tab, HUDL, anything that plays). YouTube blocks servers
// from fetching video, and the storyboard fallback is 320x180 — far too small
// to read a jersey. The browser's own screen-share stream is full resolution,
// needs no download, and costs nothing to run.
//
// Density is kept even for any length: sample every SAMPLE_MS, and whenever
// the budget fills, drop every other frame and double the interval. A 30
// second clip and a 40 minute game both come back evenly covered.
export function screenCaptureSupported(): boolean {
  return typeof navigator !== "undefined"
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getDisplayMedia === "function";
}

async function captureFramesFromScreen(
  onProgress: (frames: number, elapsedSec: number) => void,
  shouldStop: () => boolean,
): Promise<{ frames: FrameWithTime[]; durationSec: number }> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 15 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });

  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;

  const stopStream = () => stream.getTracks().forEach(t => t.stop());

  try {
    await video.play();
    // Wait for real dimensions before sizing the canvas.
    if (!video.videoWidth) {
      await new Promise<void>((done) => {
        const t = setTimeout(done, 3000);
        video.onloadedmetadata = () => { clearTimeout(t); done(); };
      });
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");

    // Fit inside 1152x648 preserving aspect — same budget the clip path uses,
    // since a capture may be analyzed as either a clip or a game.
    const srcW = video.videoWidth || 1280, srcH = video.videoHeight || 720;
    const scale = Math.min(1152 / srcW, 648 / srcH, 1);
    canvas.width = Math.max(2, Math.round(srcW * scale));
    canvas.height = Math.max(2, Math.round(srcH * scale));

    // The user can also end sharing from the browser's own bar.
    let sharingEnded = false;
    stream.getVideoTracks()[0].addEventListener("ended", () => { sharingEnded = true; });

    const MAX_FRAMES = 240;
    const MAX_MS = 45 * 60 * 1000;
    let intervalMs = 2000;
    let frames: FrameWithTime[] = [];
    const startedAt = Date.now();

    while (!sharingEnded && !shouldStop() && Date.now() - startedAt < MAX_MS) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const elapsed = (Date.now() - startedAt) / 1000;
      frames.push({ dataUrl: canvas.toDataURL("image/jpeg", 0.7), timestamp: elapsed });

      // Budget full: halve the density and keep going, so coverage stays even
      // no matter how long they capture.
      if (frames.length >= MAX_FRAMES) {
        frames = frames.filter((_, i) => i % 2 === 0);
        intervalMs *= 2;
      }

      onProgress(frames.length, elapsed);
      await new Promise(r => setTimeout(r, intervalMs));
    }

    const durationSec = (Date.now() - startedAt) / 1000;
    return { frames, durationSec };
  } finally {
    stopStream();
    video.srcObject = null;
  }
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
    ctx.fillText("www.getreel.org", W/2, H - 40);

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
    ctx.fillText("www.getreel.org", W - pad, H - Math.round(8 * F));
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
  return <p className="mb-1.5 text-[12px] text-muted-foreground">{children}</p>;
}

function ProgressBar({ current, total, label }: { current: number; total: number; label: string }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-muted-foreground"><span>{label}</span><span>{pct}%</span></div>
      <div className="h-px w-full bg-accent">
        <div className="h-px bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Player Card ──────────────────────────────────────────────────────────────

// Jersey/team color, read from the front of the AI's player label (e.g.
// "Blue #4 Wing", "White #12 On-ball Guard") — used to accent each card by
// team instead of every card looking identical regardless of side.
const TEAM_COLOR_WORDS: Record<string, string> = {
  white: "#d4d4d8", black: "#3f3f46", gray: "#71717a", grey: "#71717a", silver: "#a1a1aa",
  red: "#ef4444", scarlet: "#dc2626", crimson: "#991b1b", maroon: "#7f1d1d", cardinal: "#991b1b", burgundy: "#7f1d1d",
  blue: "#3b82f6", navy: "#1e40af", teal: "#14b8a6", turquoise: "#06b6d4", cyan: "#22d3ee",
  green: "#22c55e", olive: "#65a30d", lime: "#84cc16", mint: "#34d399",
  yellow: "#eab308", gold: "#ca8a04", orange: "#f97316", purple: "#a855f7", violet: "#8b5cf6",
  pink: "#ec4899", magenta: "#d946ef", brown: "#92400e", tan: "#b45309", beige: "#d6d3d1", cream: "#e7e5e4",
};
// Modifiers that precede a base color word, e.g. "Navy Blue", "Light Gray", "Dark Green".
const TEAM_COLOR_MODIFIERS = new Set(["light", "dark", "royal", "baby", "sky", "forest", "kelly", "hunter", "bright", "neon", "hot", "electric", "burnt"]);
// Distinct, stable colors for team labels that aren't a recognizable color word
// (e.g. "Team A", "Home") so unrecognized teams still get consistent, distinguishable accents.
const FALLBACK_PALETTE = ["#3b82f6", "#ef4444", "#22c55e", "#eab308", "#a855f7", "#f97316", "#14b8a6", "#ec4899"];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function capitalize(s: string) {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function extractTeamTag(player: string): { label: string; hex: string } {
  const words = player.trim().toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z]/g, "")).filter(Boolean);
  const [w1, w2] = words;
  if (w1 && TEAM_COLOR_MODIFIERS.has(w1) && w2 && TEAM_COLOR_WORDS[w2]) {
    return { label: `${w1} ${w2}`, hex: TEAM_COLOR_WORDS[w2] };
  }
  if (w1 && TEAM_COLOR_WORDS[w1]) {
    return { label: w1, hex: TEAM_COLOR_WORDS[w1] };
  }
  const key = w1 || "team";
  return { label: key, hex: FALLBACK_PALETTE[hashString(key) % FALLBACK_PALETTE.length] };
}

const DECISION_FIELDS = [
  { key: "whatHappened"     as const, label: "What Happened"      },
  { key: "decisionRead"     as const, label: "Coach's Read"       },
  { key: "bestAlternative"  as const, label: "Next Time"          },
  { key: "whyBetter"        as const, label: "Why It Was Better"  },
  { key: "patternToImprove" as const, label: "Pattern To Improve" },
  { key: "practiceFocus"    as const, label: "Practice This Week" },
];

function parseDrills(text: string): { solo: string[]; team: string[] } {
  const clean = (block: string) => block.split("\n").map(l => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
  const parts = text.split(/With\s+Teammates?:/i);
  const soloBlock = (parts[0] || "").replace(/^[\s\S]*?Solo:/i, "");
  return { solo: clean(soloBlock), team: clean(parts[1] || "") };
}

// Full-screen drills page for one player's weakness — solo + with-teammates,
// each a single sentence. Generated on demand from what that specific player
// needs to improve, so the coaching is tied to the card, not a guess about
// who the uploader is.
function DrillsOverlay({ decision, onClose }: { decision: PlayerDecision; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drills, setDrills] = useState<{ solo: string[]; team: string[] }>({ solo: [], team: [] });
  const focus = decision.patternToImprove || decision.bestAlternative || decision.whatHappened || decision.role;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/drills", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sport: decision.sport, role: decision.role, focus }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (data.error || !res.ok) { setError(data.error || "Couldn't build drills — try again."); return; }
        setDrills(parseDrills(data.drills ?? ""));
      } catch {
        if (!cancelled) setError("Couldn't build drills — check your connection.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const name = decision.player.replace(/\s*\([^)]*\)/, "").trim() || "This player";

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/30 backdrop-blur-sm p-4 sm:p-8" onClick={onClose}>
      <div className="surface mx-auto max-w-lg p-5 sm:p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-foreground">Drills for {name}</p>
            <p className="text-xs text-muted-foreground">To fix: {focus}</p>
          </div>
          <button onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Building drills…
          </div>
        )}
        {error && <p className="py-6 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {!loading && !error && (
          <div className="mt-4 space-y-5">
            {drills.solo.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground"><Dumbbell className="h-3.5 w-3.5" /> On your own</p>
                <ul className="space-y-2">
                  {drills.solo.map((d, i) => (
                    <li key={i} className="flex items-start justify-between gap-3 rounded-lg bg-muted p-3">
                      <span className="text-sm text-foreground leading-snug">{d}</span>
                      <button onClick={() => openDrillCheck(d)}
                        className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground hover:border-ring">Check form</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {drills.team.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground"><Users className="h-3.5 w-3.5" /> With teammates</p>
                <ul className="space-y-2">
                  {drills.team.map((d, i) => (
                    <li key={i} className="rounded-lg bg-muted p-3 text-sm text-foreground leading-snug">{d}</li>
                  ))}
                </ul>
              </div>
            )}
            {drills.solo.length === 0 && drills.team.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">No drills came back — try again.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerCard({ decision, defaultOpen = false }: {
  decision: PlayerDecision;
  defaultOpen?: boolean;
}) {
  const [open,    setOpen]    = useState(defaultOpen);
  const [sharing, setSharing] = useState(false);
  const [showDrills, setShowDrills] = useState(false);

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
  const grade = decision.grade || "N/A";
  const team  = extractTeamTag(decision.player);

  // One block of the expanded card. Dividers instead of a stack of grey
  // boxes — eight identical panels read as a debug dump, not a coaching note.
  const Block = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="border-t border-border/60 pt-3.5">
      <p className="mb-1 text-[12px] text-muted-foreground">{label}</p>
      {children}
    </div>
  );

  return (
    <div className="group relative">
      {/* Timeline rail: the connecting line and the moment itself. */}
      <div className="absolute bottom-0 left-[46px] top-11 w-px bg-border" aria-hidden />

      <div className="flex gap-3">
        <div className="w-[46px] shrink-0 pt-3.5 text-right">
          <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
            {decision.timestamp || "—"}
          </span>
        </div>

        <div className="relative min-w-0 flex-1 pb-3">
          {/* Node on the rail */}
          <span className="absolute -left-[10px] top-[18px] h-2 w-2 rounded-full ring-4 ring-background"
            style={{ backgroundColor: team.hex }} aria-hidden />

          <div className={`overflow-hidden rounded-lg border bg-card transition-colors ${open ? "border-ring" : "border-border group-hover:border-ring/60"}`}>
            <div role="button" tabIndex={0} onClick={() => setOpen(o => !o)}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); } }}
              className="flex cursor-pointer items-start gap-3 px-4 py-3.5">
              <span className={`mt-0.5 shrink-0 rounded-md px-2 py-1 text-xs font-semibold tabular-nums ${gradeClass(grade, "bg")} ${gradeClass(grade, "text")}`}>
                {grade}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{decision.player || "Unknown player"}</p>
                  {decision.role && (
                    <p className="hidden truncate text-xs text-muted-foreground sm:block">{decision.role}</p>
                  )}
                </div>
                {(decision.action || decision.whatHappened) && (
                  <p className={`mt-1 text-[13px] leading-snug text-muted-foreground ${open ? "" : "line-clamp-2"}`}>
                    {decision.action || decision.whatHappened}
                  </p>
                )}
              </div>

              <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} />
            </div>

            {open && (
              <div className="space-y-3.5 px-4 pb-4">
                {decision.whatHappened && decision.action && (
                  <Block label="What happened">
                    <p className="text-sm leading-relaxed text-foreground">{decision.whatHappened}</p>
                  </Block>
                )}
                {decision.decisionRead && (
                  <Block label="The read">
                    <p className="text-sm leading-relaxed text-foreground">{decision.decisionRead}</p>
                  </Block>
                )}
                {decision.bestAlternative && (
                  <Block label="Better option">
                    <p className="text-sm leading-relaxed text-foreground">{decision.bestAlternative}</p>
                    {decision.whyBetter && (
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{decision.whyBetter}</p>
                    )}
                  </Block>
                )}
                {decision.otherOptions.length > 0 && (
                  <Block label="Other options">
                    <ul className="space-y-1">
                      {decision.otherOptions.map((opt, i) => (
                        <li key={i} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
                          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />{opt}
                        </li>
                      ))}
                    </ul>
                  </Block>
                )}
                {decision.patternToImprove && (
                  <Block label="The pattern">
                    <p className="text-sm leading-relaxed text-foreground">{decision.patternToImprove}</p>
                  </Block>
                )}

                {decision.practiceFocus && (
                  <div className="rounded-lg bg-muted p-3.5">
                    <p className="mb-1 text-[12px] text-muted-foreground">Drill it</p>
                    <p className="text-sm leading-relaxed text-foreground">{decision.practiceFocus}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm"
                        onClick={e => { e.stopPropagation(); setShowDrills(true); }}>
                        <Dumbbell className="h-3.5 w-3.5" /> More drills
                      </Button>
                      <Button variant="secondary" size="sm"
                        onClick={e => { e.stopPropagation(); openDrillCheck(decision.practiceFocus); }}>
                        <Video className="h-3.5 w-3.5" /> Check my form
                      </Button>
                    </div>
                  </div>
                )}

                <button onClick={e => handleShare(e, "landscape")} disabled={sharing}
                  className="text-xs font-semibold text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground disabled:opacity-40">
                  {sharing ? "Preparing…" : "Share this card"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {showDrills && <DrillsOverlay decision={decision} onClose={() => setShowDrills(false)} />}
    </div>
  );
}

export function PlayerCardList({ decisions }: { decisions: PlayerDecision[] }) {
  // When moments are placed on the tape, the timeline IS the organizing idea:
  // one flat run through the game, earliest to latest. Grouping by team here
  // would scramble it — you'd read 3:33, 7:44, 37:40 and then jump back to
  // 4:08 for the other team.
  const timed = decisions.some(d => d.timestamp);
  if (timed) {
    return (
      <div className="space-y-0">
        {decisions.map((d, i) => (
          <PlayerCard key={i} decision={d} defaultOpen={i === 0} />
        ))}
      </div>
    );
  }

  // No timestamps (frame-based clips): fall back to team rosters so a
  // two-team clip still reads as two sections instead of one flat list.
  const groups = new Map<string, { label: string; hex: string; decisions: PlayerDecision[] }>();
  for (const d of decisions) {
    const tag = extractTeamTag(d.player);
    if (!groups.has(tag.label)) groups.set(tag.label, { label: tag.label, hex: tag.hex, decisions: [] });
    groups.get(tag.label)!.decisions.push(d);
  }
  const sorted   = [...groups.values()].sort((a, b) => b.decisions.length - a.decisions.length);
  const sections = sorted.slice(0, 2);
  const extras   = sorted.slice(2).flatMap(g => g.decisions);
  if (extras.length) sections[sections.length - 1].decisions.push(...extras);

  if (sections.length < 2) {
    return (
      <div className="space-y-3">
        {decisions.map((d, i) => (
          <PlayerCard key={i} decision={d} defaultOpen={i === 0} />
        ))}
      </div>
    );
  }

  // Teams stack vertically (each a full-width section) rather than side-by-side
  // columns — side-by-side made every card half-width and hard to read.
  return (
    <div className="space-y-7">
      {sections.map((s, si) => (
        <div key={s.label} className="space-y-3">
          <div className="flex items-center gap-2 px-1 pb-1">
            <span className="h-2.5 w-2.5 rounded-full border border-black/20" style={{ backgroundColor: s.hex }} />
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{capitalize(s.label)} · {s.decisions.length}</p>
          </div>
          {s.decisions.map((d, i) => (
            <PlayerCard key={i} decision={d} defaultOpen={si === 0 && i === 0} />
          ))}
        </div>
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

// Team tabs + one table, instead of two cramped tables stacked. Teams come in
// the report's own order (uploader's first) when the analysis resolved them.
function boxTeams<R extends { team: string }>(rows: R[], report?: GameReport) {
  const order = report?.teams?.map(t => t.color) ?? [];
  const groups = new Map<string, R[]>();
  for (const r of rows) {
    if (!r.team || r.team === "unknown") continue;
    if (!groups.has(r.team)) groups.set(r.team, []);
    groups.get(r.team)!.push(r);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return groups.get(b)!.length - groups.get(a)!.length;
  }).slice(0, 2);
  const name = (c: string) => report?.teams?.find(t => t.color === c)?.name ?? c.charAt(0).toUpperCase() + c.slice(1);
  return keys.map(k => ({ color: k, name: name(k), rows: groups.get(k)! }));
}

// Named players first by the headline stat; jersey-less "Gray Unknown" rows
// (baskets whose scorer couldn't be read) last — they count for the team.
function playerCell(label: string, jersey: string | null) {
  if (!jersey) return <span className="text-muted-foreground">Unattributed</span>;
  return <span className="font-mono text-[13px] text-foreground">#{jersey}</span>;
}

function VolleyBoxPanel({ rows, report }: { rows: PlayerVolleyStat[]; report?: GameReport }) {
  const teams = boxTeams(rows, report);
  const [active, setActive] = useState(0);
  const team = teams[Math.min(active, teams.length - 1)];
  if (!team) return null;
  const hit = (k: number, e: number, ta: number) => ta > 0 ? ((k - e) / ta).toFixed(3).replace(/^(-?)0\./, "$1.") : "—";
  const sorted = [...team.rows].sort((a, b) => (+!!b.jersey - +!!a.jersey) || b.k - a.k || b.ta - a.ta);
  const sum = (k: keyof PlayerVolleyStat) => team.rows.reduce((n, r) => n + (r[k] as number), 0);
  const cols: StatCol<PlayerVolleyStat>[] = [
    { key: "k", label: "K", title: "Kills", value: r => r.k, lead: r => r.k },
    { key: "hit", label: "HIT%", title: "Hitting percentage", value: r => hit(r.k, r.e, r.ta), muted: true },
    { key: "e", label: "E", title: "Attack errors", value: r => r.e, muted: true },
    { key: "ta", label: "TA", title: "Total attacks", value: r => r.ta, muted: true },
    { key: "ast", label: "AST", title: "Set assists", value: r => r.ast, lead: r => r.ast },
    { key: "sa", label: "SA", title: "Service aces", value: r => r.sa, lead: r => r.sa },
    { key: "se", label: "SE", title: "Service errors", value: r => r.se, muted: true },
    { key: "d", label: "DIG", title: "Digs", value: r => r.d, lead: r => r.d },
    { key: "bs", label: "BLK", title: "Stuff blocks", value: r => r.bs, lead: r => r.bs },
    { key: "re", label: "RE", title: "Reception errors", value: r => r.re, muted: true },
  ];
  return (
    <section className="surface p-5 sm:p-6">
      <StatHeader title="Box score" sub="Counted from every logged rally"
        right={teams.length > 1 && <Segmented value={String(active)} onChange={v => setActive(+v)} options={teams.map((t, i) => ({ value: String(i), label: t.name }))} />} />
      <StatTable cols={cols} rows={sorted} rowKey={r => r.player} name={r => playerCell(r.player, r.jersey)}
        footer={{ name: "Team", cells: [sum("k"), hit(sum("k"), sum("e"), sum("ta")), sum("e"), sum("ta"), sum("ast"), sum("sa"), sum("se"), sum("d"), sum("bs"), sum("re")] }} />
    </section>
  );
}

function BoxScorePanel({ rows, report, roster = [], onPlayer }: { rows: PlayerBoxStat[]; report?: GameReport; roster?: RosterTeam[]; onPlayer?: (p: RosterPlayer) => void }) {
  const byKey = new Map(roster.flatMap(t => t.players).map(p => [p.key, p]));
  const who = (r: PlayerBoxStat) => r.jersey ? byKey.get(`${r.team}#${r.jersey}`) : undefined;
  const teams = boxTeams(rows, report);
  const [active, setActive] = useState(0);
  const team = teams[Math.min(active, teams.length - 1)];
  if (!team) return null;
  const sorted = [...team.rows].sort((a, b) => (+!!b.jersey - +!!a.jersey) || b.pts - a.pts || b.reb - a.reb);
  const t = team.rows.reduce((acc, r) => {
    for (const k of ["pts", "reb", "ast", "stl", "blk", "tov", "pf", "fgm", "fga", "tpm", "tpa", "ftm", "fta"] as const) acc[k] += r[k];
    return acc;
  }, { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 });
  const sb = report?.scoreboard?.teams.find(s => s.color === team.color);
  const shoot = (m: number, a: number) => <span>{m}<span className="text-muted-foreground">–{a}</span></span>;
  const cols: StatCol<PlayerBoxStat>[] = [
    { key: "pts", label: "PTS", title: "Points", value: r => r.pts, lead: r => r.pts },
    { key: "reb", label: "REB", title: "Rebounds", value: r => r.reb, lead: r => r.reb },
    { key: "ast", label: "AST", title: "Assists", value: r => r.ast, lead: r => r.ast },
    { key: "stl", label: "STL", title: "Steals", value: r => r.stl, lead: r => r.stl },
    { key: "blk", label: "BLK", title: "Blocks", value: r => r.blk, lead: r => r.blk },
    { key: "fg", label: "FG", title: "Field goals made–attempted", value: r => shoot(r.fgm, r.fga) },
    { key: "3p", label: "3PT", title: "Threes made–attempted", value: r => shoot(r.tpm, r.tpa) },
    { key: "ft", label: "FT", title: "Free throws made–attempted", value: r => shoot(r.ftm, r.fta) },
    { key: "tov", label: "TO", title: "Turnovers", value: r => r.tov, muted: true },
    { key: "pf", label: "PF", title: "Personal fouls", value: r => r.pf, muted: true },
    { key: "dec", label: "DEC", title: "Good / poor decisions logged", value: r => {
      const p = who(r);
      return p && p.good + p.poor > 0
        ? <span className="inline-flex items-center gap-1.5 text-[12px]"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{p.good}<span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-red-500" />{p.poor}</span>
        : <span className="text-muted-foreground">—</span>;
    } },
  ];
  return (
    <section className="surface p-5 sm:p-6">
      <StatHeader title="Box score"
        sub={sb ? <CoverageMeter tracked={t.pts} total={sb.final - sb.start} /> : "Counted from every logged play · tap a player for details"}
        right={teams.length > 1 && <Segmented value={String(active)} onChange={v => setActive(+v)} options={teams.map((x, i) => ({ value: String(i), label: x.name }))} />} />
      <StatTable cols={cols} rows={sorted} rowKey={r => r.player} name={r => playerCell(r.player, r.jersey)}
        onRowClick={onPlayer ? r => { const p = who(r); if (p) onPlayer(p); } : undefined}
        footer={{ name: "Team", cells: [t.pts, t.reb, t.ast, t.stl, t.blk,
          ...([[t.fgm, t.fga], [t.tpm, t.tpa], [t.ftm, t.fta]] as const).map(([m, a], i) => (
            <span key={i} className="inline-flex flex-col items-end leading-tight">{m}–{a}<span className="text-[11px] font-normal text-muted-foreground">{pctText(m, a)}</span></span>
          )), t.tov, t.pf, ""] }} />
    </section>
  );
}

export function GameResultsView({ report, onClose, backLabel = "New analysis", sourceName }: { report: GameReport; onClose: () => void; backLabel?: string; sourceName?: string }) {
  const [focus, setFocus] = useState<RosterPlayer | null>(null);
  const [filmRoom, setFilmRoom] = useState(false);
  // Film room only works when we know which video this came from and we have
  // moments to jump to.
  const videoId = youtubeIdFrom(sourceName);
  const canWatch = !!videoId && (report.playerCards?.length ?? 0) > 0;
  const tc = report.teamComparison ?? null;

  // Team columns come from counted data (box score + decision timeline),
  // not from the model's prose.
  const teams = buildRosterView(report);

  if (filmRoom && videoId) {
    return <FilmRoom videoId={videoId} decisions={report.playerCards ?? []} timeline={report.timeline ?? []} onClose={() => setFilmRoom(false)} />;
  }

  const hasBox = (report.volleyBox?.length ?? 0) > 0 || (report.boxScore?.length ?? 0) > 0;
  const notes = GAME_SECTIONS.filter(({ key }) => report[key]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      {/* Top bar */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <button onClick={onClose} className="btn-pill btn-light !py-2 !text-[13px]">
            <ChevronDown className="h-3.5 w-3.5 rotate-90" /> {backLabel}
          </button>
          <p className="hidden text-sm text-muted-foreground sm:block">Game report</p>
          <div className="flex items-center gap-2">
            {canWatch && (
              <button onClick={() => setFilmRoom(true)} className="btn-pill btn-dark !py-2 !text-[13px]">
                <Video className="h-3.5 w-3.5" /> Watch
              </button>
            )}
            <span title="Overall decision grade"
              className={`flex h-9 min-w-9 items-center justify-center rounded-full px-2.5 text-sm font-semibold ${gradeClass(report.overallGrade, "bg")} ${gradeClass(report.overallGrade, "text")}`}>
              {report.overallGrade}
            </span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-5 px-4 pb-24 pt-4 sm:px-6">
        {/* Scoreboard + why */}
        {tc ? <TeamComparisonPanel tc={tc} hasScoreboard={!!report.scoreboard} teams={teams} /> : (
          <div className="surface p-6">
            <p className="text-sm text-muted-foreground">No scoreboard or team totals were readable in this footage, so there&apos;s no team comparison for this game.</p>
          </div>
        )}

        {/* What the player actually did — drawn from the counted decisions. */}
        {((report.didWell?.length ?? 0) > 0 || (report.workOn?.length ?? 0) > 0) && (
          <div className="surface grid sm:grid-cols-2">
            {[["Did well", report.didWell ?? [], "bg-emerald-500"], ["Work on", report.workOn ?? [], "bg-court"]].map(([label, items, dot], i) => (
              (items as string[]).length > 0 && (
                <div key={label as string} className={`p-5 sm:p-6 ${i === 1 ? "border-t border-border sm:border-l sm:border-t-0" : ""}`}>
                  <p className="mb-3 text-[13px] text-muted-foreground">{label as string}</p>
                  <ul className="space-y-2.5">
                    {(items as string[]).map((s, k) => (
                      <li key={k} className="flex items-start gap-3 text-[15px] leading-snug text-foreground">
                        <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot as string}`} />{s}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            ))}
          </div>
        )}

        {/* Box score — the builders are sport-exclusive, so at most one renders */}
        {hasBox && (report.volleyBox && report.volleyBox.length > 0
          ? <VolleyBoxPanel rows={report.volleyBox} report={report} />
          : <BoxScorePanel rows={report.boxScore!} report={report} roster={teams} onPlayer={setFocus} />)}

        {/* Team stat comparison */}
        {tc && tc.stats.length > 0 && <TeamStatBars tc={tc} />}

        {/* Players by team — only when there's no box score to carry them
            (volleyball, or a game where no stat events were logged). */}
        {!(report.boxScore?.length) && teams.some(t => t.players.length > 0) && (
          <section className="surface p-5 sm:p-6">
            <StatHeader title="Players" sub="Tap a player for their full line and decisions" />
            <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
              {teams.map(t => (
                <div key={t.color}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 pb-1">
                    <p className="text-[15px] text-foreground">{t.name ?? <span className="capitalize">{t.color}</span>}
                      {t.name && <span className="ml-2 text-[13px] capitalize text-muted-foreground">{t.color}</span>}</p>
                    <span className="text-[12px] text-muted-foreground">{t.players.length}</span>
                  </div>
                  <div className="divide-y divide-border border-t border-border">
                    {t.players.map(pl => {
                      const b = pl.box;
                      return (
                        <button key={pl.key} onClick={() => setFocus(pl)}
                          className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted">
                          <span className="w-9 shrink-0 font-mono text-[13px] text-foreground">#{pl.jersey}</span>
                          <span className="min-w-0 flex-1 text-[13px] tabular-nums">
                            {b ? <span className="text-foreground">{b.pts} <span className="text-muted-foreground">pts</span> · {b.reb} <span className="text-muted-foreground">reb</span> · {b.ast} <span className="text-muted-foreground">ast</span></span>
                              : <span className="text-muted-foreground">No stats logged</span>}
                          </span>
                          {(pl.good + pl.poor) > 0 && (
                            <span className="flex shrink-0 items-center gap-1.5 text-[12px] tabular-nums text-muted-foreground" title="Good / poor decisions">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{pl.good}
                              <span className="ml-1 h-1.5 w-1.5 rounded-full bg-red-500" />{pl.poor}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Coachable moments */}
        {(report.playerCards?.length ?? 0) > 0 && (
          <section className="pt-4">
            <StatHeader title="Coachable moments"
              sub={`${report.playerCards!.length} breakdowns${(report.timeline?.length ?? 0) > 0 ? ` · ${report.timeline!.length} plays logged` : ""}`}
              right={canWatch && (
                <button onClick={() => setFilmRoom(true)} className="btn-pill btn-dark !py-2 !text-[13px]">
                  <Video className="h-3.5 w-3.5" /> Watch with analysis
                </button>
              )} />
            <PlayerCardList decisions={report.playerCards!} />
          </section>
        )}

        {/* Coaching notes */}
        {(notes.length > 0 || report.strengths.length > 0 || report.improvements.length > 0) && (
          <section className="surface divide-y divide-border">
            {notes.map(({ key, label }) => (
              <div key={key} className="grid gap-2 p-5 sm:grid-cols-[11rem_1fr] sm:gap-6 sm:p-6">
                <p className="text-[13px] text-muted-foreground">{label}</p>
                <div>
                  <p className="text-[15px] leading-relaxed text-foreground">{report[key] as string}</p>
                  {key === "practiceFocus" && (
                    <button onClick={() => openDrillCheck(report[key] as string)} className="btn-pill btn-light mt-3 !py-2 !text-[13px]">
                      <Video className="h-3.5 w-3.5" /> Check my drill
                    </button>
                  )}
                </div>
              </div>
            ))}
            {[["Strengths", report.strengths, "bg-emerald-500"], ["Areas to improve", report.improvements, "bg-court"]].map(([label, items, dot]) => (
              (items as string[]).length > 0 && (
                <div key={label as string} className="grid gap-2 p-5 sm:grid-cols-[11rem_1fr] sm:gap-6 sm:p-6">
                  <p className="text-[13px] text-muted-foreground">{label as string}</p>
                  <ul className="space-y-2">
                    {(items as string[]).map((x, i) => (
                      <li key={i} className="flex items-start gap-3 text-[15px] leading-snug text-foreground">
                        <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot as string}`} />{x}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            ))}
          </section>
        )}
      </div>

      {/* Player detail modal */}
      {focus && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm" onClick={() => setFocus(null)}>
          <div className="w-full max-w-sm rounded-3xl bg-card p-6 shadow-lift" onClick={e => e.stopPropagation()}>
            <div className="mb-5 flex items-center gap-4">
              <span className="font-display text-5xl tabular-nums leading-none text-foreground">#{focus.jersey}</span>
              <div className="min-w-0">
                <p className="text-[15px] text-foreground">{focus.label}</p>
                <p className="text-xs capitalize text-muted-foreground">
                  {teams.find(t => t.color === focus.color)?.name ?? focus.color}
                </p>
              </div>
            </div>
            {focus.box && (
              <div className="mb-5 grid grid-cols-4 gap-y-3 text-center">
                {([
                  ["PTS", focus.box.pts], ["REB", focus.box.reb], ["AST", focus.box.ast], ["STL", focus.box.stl],
                  ["FG", `${focus.box.fgm}/${focus.box.fga}`], ["3PT", `${focus.box.tpm}/${focus.box.tpa}`],
                  ["TOV", focus.box.tov], ["PF", focus.box.pf],
                ] as [string, string | number][]).map(([k, v]) => (
                  <div key={k}>
                    <p className="text-xl tabular-nums text-foreground">{v}</p>
                    <p className="text-[11px] text-muted-foreground">{k}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="mb-5 flex items-baseline gap-4 border-t border-border pt-4 text-sm">
              <span className="text-muted-foreground">Decisions</span>
              <span><span className="font-bold text-emerald-500">{focus.good}</span> good</span>
              <span><span className="font-bold text-foreground">{focus.neutral}</span> neutral</span>
              <span><span className="font-bold text-red-500">{focus.poor}</span> poor</span>
            </div>
            {focus.standout && (
              <div className="mb-5">
                <p className="mb-1 text-[12px] text-muted-foreground">Standout moment</p>
                <p className="text-sm leading-relaxed text-foreground">{focus.standout}</p>
              </div>
            )}
            <button onClick={() => setFocus(null)} className="btn-pill btn-dark w-full">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Team Comparison (light score-panel style) ────────────────────────────────

function teamInitials(name: string) {
  // "Titanium (Gray)" -> "TI", "Anaheim Select (Blue)" -> "AS"
  const words = name.replace(/\([^)]*\)/g, "").trim().split(/\s+/).filter(w => /^[a-z0-9]/i.test(w));
  if (words.length === 0) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words.map(w => w[0]).join("").slice(0, 2)).toUpperCase();
}

function TeamComparisonPanel({ tc, hasScoreboard = false, teams = [] }: { tc: TeamComparison; hasScoreboard?: boolean; teams?: RosterTeam[] }) {
  const [scoreA, scoreB] = tc.score?.match(/(\d+)\s*[–\-:]\s*(\d+)/)?.slice(1) ?? [null, null];
  // W/L only means something next to a real score.
  const hasScore = scoreA != null && scoreB != null;
  const aWon = hasScore ? +scoreA! > +scoreB! : false;
  const bWon = hasScore ? +scoreB! > +scoreA! : false;
  const nameOf = (s: string) => s.replace(/\s*\([^)]*\)/, "");
  const colorOf = (s: string) => s.match(/\(([^)]+)\)/)?.[1] ?? "";
  // Reviews saved before the parser fix carry this header on the end.
  const why = tc.why.replace(/\s*COACHABLE MOMENTS:?\s*$/i, "");
  const tracked = teams.reduce((n, t) => n + (t.totals?.pts ?? 0), 0);
  const onFilm = teams.reduce((n, t) => n + (t.scoredOnFilm ?? 0), 0);

  const Side = ({ label, score, won, right }: { label: string; score: string | null; won: boolean; right?: boolean }) => (
    <div className={`min-w-0 ${right ? "text-right" : ""}`}>
      <p className="truncate text-[15px] text-foreground">{nameOf(label)}</p>
      <p className="text-[12px] capitalize text-muted-foreground">{colorOf(label)}{hasScore && <span> · {won ? "Won" : bWon || aWon ? "Lost" : "Tied"}</span>}</p>
      {score != null && (
        <p className={`mt-3 font-display text-6xl tabular-nums leading-none sm:text-7xl ${won ? "text-foreground" : "text-quiet"}`}>{score}</p>
      )}
    </div>
  );

  return (
    <section className="surface p-5 sm:p-7">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-4">
        <Side label={tc.teamA} score={scoreA} won={aWon} />
        <p className="pb-2 text-[11px] text-muted-foreground">{hasScore ? (hasScoreboard ? "Final" : "Score") : "vs"}</p>
        <Side label={tc.teamB} score={scoreB} won={bWon} right />
      </div>
      {(hasScoreboard || onFilm > 0) && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-[12px] text-muted-foreground">{hasScoreboard ? "Read off the in-game scoreboard" : ""}</p>
          {onFilm > 0 && <CoverageMeter tracked={tracked} total={onFilm} />}
        </div>
      )}
      {why && (
        <div className="mt-5 border-t border-border pt-5">
          <p className="mb-1.5 text-[13px] text-muted-foreground">{tc.winner ? `Why ${nameOf(tc.winner)} won` : "What decided it"}</p>
          <p className="text-[15px] leading-relaxed text-foreground">{why}</p>
        </div>
      )}
    </section>
  );
}

// Team stats side by side: numbers either end, a thin two-shade bar between.
function TeamStatBars({ tc }: { tc: TeamComparison }) {
  const nameOf = (s: string) => s.replace(/\s*\([^)]*\)/, "");
  return (
    <section className="surface p-5 sm:p-6">
      <div className="mb-4 flex items-baseline justify-between text-[13px] text-muted-foreground">
        <span className="text-foreground">{nameOf(tc.teamA)}</span>
        <span>Team stats</span>
        <span className="text-foreground">{nameOf(tc.teamB)}</span>
      </div>
      <div className="space-y-3.5">
        {tc.stats.map(({ label, a, b }) => {
          const total = a + b;
          const aPct = total > 0 ? (a / total) * 100 : 50;
          return (
            <div key={label}>
              <div className="mb-1.5 flex items-baseline justify-between text-[14px] tabular-nums">
                <span className={a > b ? "font-semibold text-foreground" : "text-foreground/70"}>{a}</span>
                <span className="text-[13px] text-muted-foreground">{label}</span>
                <span className={b > a ? "font-semibold text-foreground" : "text-foreground/70"}>{b}</span>
              </div>
              {/* Team shades, not green/red: more turnovers isn't "winning" the bar. */}
              <div className="flex h-1 gap-1">
                <div className="rounded-full bg-foreground" style={{ width: `${aPct}%` }} />
                <div className="flex-1 rounded-full bg-foreground/15" />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Find My Player ───────────────────────────────────────────────────────────

// Identify THIS athlete among the graded players. Deliberately strict: a
// jersey number is required, because team color alone just picks an arbitrary
// teammate — and mislabeling someone else as "you" corrupts the user's grade
// history. Returns null when we can't be reasonably sure, and callers must
// treat null as "not graded" rather than substituting another player.
function findMyPlayer(decisions: PlayerDecision[], jersey?: string, teamColor?: string): PlayerDecision | null {
  if (!decisions.length) return null;
  const j = jersey?.toLowerCase().replace(/^#/, "").trim();
  if (!j) return null;
  const c = teamColor?.toLowerCase().trim();
  const scored = decisions.map(d => {
    const p = d.player.toLowerCase();
    let score = 0;
    if (p.includes(`#${j}`)) score += 3;          // explicit jersey match
    else if (new RegExp(`\\b${j}\\b`).test(p)) score += 2; // bare number, word-bounded
    if (score > 0 && c && p.includes(c)) score += 1;       // same team confirms it
    return { d, score };
  });
  const best = scored.sort((a, b) => b.score - a.score)[0];
  return best.score >= 2 ? best.d : null;
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
        <div className="h-16 w-16 rounded-full border-2 border-border animate-ping absolute opacity-20" />
        <div className="h-10 w-10 rounded-full bg-primary/10 border border-border flex items-center justify-center">
          <div className="h-3 w-3 rounded-full bg-primary animate-pulse" />
        </div>
      </div>

      {/* Steps */}
      <div className="w-full space-y-2">
        {ANALYSIS_STEPS.map((step, i) => {
          const done    = i < stepIndex;
          const active  = i === stepIndex;
          const pending = i > stepIndex;
          return (
            <div key={step.key} className={`flex items-center gap-3 rounded-lg px-4 py-2.5 transition-all ${active ? "border border-border bg-muted" : "opacity-30"}`}>
              <div className={`h-4 w-4 shrink-0 rounded-full flex items-center justify-center text-[9px] font-bold transition-all ${ done ? "bg-primary text-primary-foreground" : active ? "border border-white" : "border border-border"
              }`}>
                {done ? "✓" : active ? <span className="animate-pulse">●</span> : ""}
              </div>
              <span className={`text-sm ${active ? "text-foreground font-semibold" : pending ? "text-muted-foreground" : "text-muted-foreground"}`}>
                {step.label}
              </span>
              {active && total > 1 && (
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{pct}%</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Sub-label for segment progress */}
      {label && total > 1 && (
        <p className="text-xs text-muted-foreground text-center">{label}</p>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// ─── Background job progress ──────────────────────────────────────────────────
// The server only reports checkpoints (video measured, each batch of windows
// done, report being written), minutes apart. The bar jumps to each real
// checkpoint and creeps toward the next one in between, but never past it,
// so it keeps moving without ever claiming more than has actually happened.
type JobProgressState = { status: string; progress_label: string | null; progress_current: number; progress_total: number };
const JOB_BATCH = 10; // matches VIDEO_CONCURRENCY in the Inngest game job

function jobCheckpoints(job: JobProgressState): { target: number; ceiling: number; label: string } {
  const { status, progress_label, progress_current: cur, progress_total: total } = job;
  if (status === "complete") return { target: 100, ceiling: 100, label: "Done" };
  if (status === "queued") return { target: 1, ceiling: 4, label: "Starting…" };
  if (progress_label?.startsWith("Building")) return { target: 92, ceiling: 99, label: "Writing your game report…" };
  if (progress_label?.startsWith("Double")) return { target: 88, ceiling: 92, label: "Double-checking the score…" };
  if (progress_label?.startsWith("Watching") && total > 0) {
    const at = (n: number) => 8 + 82 * Math.min(n, total) / total;
    return { target: at(cur), ceiling: at(cur + JOB_BATCH), label: `Watching the game — ${cur} of ${total} segments done` };
  }
  return { target: 3, ceiling: 8, label: "Measuring the video…" };
}

function JobProgressBar({ job, compact = false }: { job: JobProgressState; compact?: boolean }) {
  const { target, ceiling, label } = jobCheckpoints(job);
  const [shown, setShown] = useState(target);
  useEffect(() => {
    const id = setInterval(() => {
      setShown(prev => {
        if (prev < target) return prev + Math.max(0.5, (target - prev) * 0.3);
        return prev + Math.max(0, (ceiling - 0.5 - prev) * 0.012);
      });
    }, 400);
    return () => clearInterval(id);
  }, [target, ceiling]);
  const pct = Math.min(100, Math.floor(Math.max(shown, target)));
  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className={`truncate text-muted-foreground ${compact ? "text-xs" : "text-sm"}`}>{label}</span>
        <span className={`font-mono tabular-nums text-foreground ${compact ? "text-xs" : "text-sm font-semibold"}`}>{pct}%</span>
      </div>
      <div className={`w-full overflow-hidden rounded-full bg-border ${compact ? "h-1" : "h-1.5"}`}>
        <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function DecisionIQ({ profile, reviews, onReviewsChange, userId, isPro, onShowUpgrade }: {
  profile: Profile; reviews: Review[]; onReviewsChange: (r: Review[]) => void;
  userId?: string; isPro?: boolean; onShowUpgrade?: () => void;
}) {
  // Links first: pasting a public YouTube link is the fastest path to a report.
  const [inputTab,   setInputTab]   = useState<"file" | "youtube">("youtube");
  const [fileName,   setFileName]   = useState("");
  const [clipTitle,  setClipTitle]  = useState("");
  const [teamColor,  setTeamColor]  = useState(profile.teamColor || "");
  const [teamsNote,  setTeamsNote]  = useState("");
  const [videoUrl,   setVideoUrl]   = useState("");
  const [videoFile,  setVideoFile]  = useState<File | null>(null);
  const [ytUrl,      setYtUrl]      = useState("");
  const [ytError,    setYtError]    = useState("");
  const [clipFilmRoom,  setClipFilmRoom]  = useState(false);
  const [capturing,     setCapturing]     = useState(false);
  const [captureCount,  setCaptureCount]  = useState(0);
  const [captureSecs,   setCaptureSecs]   = useState(0);
  const stopCaptureRef = useRef(false);
  const [sport,      setSport]      = useState("");
  const [loading,    setLoading]    = useState(false);
  const [myTeams,       setMyTeams]       = useState<Team[]>([]);
  const [linkedTeamId,  setLinkedTeamId]  = useState("");
  const [opponentName,  setOpponentName]  = useState("");
  const [gameType,      setGameType]      = useState("Game");
  const [gameDate,      setGameDate]      = useState("");
  const [isGameFootage, setIsGameFootage] = useState(true);

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
  // The background job this screen just queued, polled so the panel shows
  // real progress and says when it's done instead of "up to 45 minutes".
  const [activeJobId,  setActiveJobId]  = useState<string | null>(null);
  const [activeJob,    setActiveJob]    = useState<(JobProgressState & { error: string | null }) | null>(null);

  useEffect(() => {
    if (!activeJobId) { setActiveJob(null); return; }
    const supabase = createClient();
    let cancelled = false;
    async function poll() {
      const { data } = await supabase.from("analysis_jobs")
        .select("status,progress_label,progress_current,progress_total,error").eq("id", activeJobId).single();
      if (cancelled || !data) return;
      setActiveJob(data);
      if (data.status === "complete" || data.status === "failed") clearInterval(interval);
    }
    poll();
    const interval = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeJobId]);

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

  // Capture whatever is playing on screen (a YouTube tab, HUDL, film app) and
  // analyze those frames. This is the reliable path for film that lives online:
  // full resolution, no download, nothing for YouTube to block.
  async function startScreenCapture(lenient = false) {
    if (!canAnalyze) return;
    setYtError("");
    stopCaptureRef.current = false;
    setCaptureCount(0); setCaptureSecs(0);

    let result: { frames: FrameWithTime[]; durationSec: number };
    try {
      setCapturing(true);
      result = await captureFramesFromScreen(
        (n, secs) => { setCaptureCount(n); setCaptureSecs(secs); },
        () => stopCaptureRef.current,
      );
    } catch (err) {
      setCapturing(false);
      const msg = err instanceof Error ? err.message : "";
      // The user dismissing the browser's picker is a cancel, not an error.
      if (!/permission|denied|abort|cancel/i.test(msg)) {
        setYtError("Couldn't capture your screen. Make sure you're on a computer and allow screen sharing when your browser asks.");
      }
      return;
    }
    setCapturing(false);

    if (result.frames.length < 3) {
      setYtError("Capture was too short to analyze. Start the capture, play the video, then stop it once the play is over.");
      return;
    }

    // Same clip/game threshold the upload path uses, measured on how much
    // footage they actually captured.
    const mode: "clip" | "game" = result.durationSec > 120 ? "game" : "clip";
    const title = ytUrl.trim() ? `YouTube: ${ytUrl.trim()}` : `Screen capture: ${new Date().toLocaleDateString()}`;

    setLoading(true);
    try {
      await runAnalysis(result.frames, mode, title, lenient);
    } catch (err) {
      console.error(err);
      setYtError(err instanceof Error ? err.message : "Analysis failed. Try again.");
    }
    setLoading(false); setProgressLabel("");
  }

  // Paste a YouTube link and analyze it directly. Gemini ingests public
  // YouTube videos natively, so this reads the real footage instead of the
  // 320x180 preview thumbnails the old scraping path was limited to.
  async function analyzeYouTube(lenient = false) {
    if (!ytUrl.trim() || !canAnalyze) return;
    setYtError("");
    setLoading(true);
    setDecisions([]); setGameReport(null); setResultMode(null); setJobStarted(false); setActiveJobId(null);
    setProgressLabel("Watching your film… this can take a few minutes for a full game.");
    setProgressTotal(1); setProgressCurrent(0);

    try {
      const res = await fetch("/api/youtube-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: ytUrl.trim(), sport: sport || profile.sport,
          jersey: profile.jersey, teamColor, teamsNote, lenient,
          isGameFootage,
          teamId: linkedTeamId || null, opponentName: opponentName.trim() || null,
          gameType: linkedTeamId ? gameType : null,
          gameDate: linkedTeamId && gameDate ? gameDate : null,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 403 && data.error === "limit_reached") { onShowUpgrade?.(); return; }
      if (res.status === 403 && data.error === "guest_limit_reached") { setYtError(data.message); return; }
      if (data.error) { setYtError(data.error); return; }
      if (!res.ok) { setYtError(`Server error ${res.status}`); return; }

      setProgressCurrent(1);
      const videoTitle = `YouTube: ${ytUrl.trim()}`;
      const thumbnailUrl = null;

      // Full games run in the background — the job poller shows progress and
      // drops the finished report into the library on its own.
      if (data.queued) {
        setJobStarted(true);
        setActiveJobId(data.jobId ?? null);
        setProgressLabel("");
        return;
      }

      if (data.mode === "clip") {
        const parsed = parsePlayerBlocks(data.feedback ?? "");
        if (parsed.length === 0) {
          setYtError("We watched the video but couldn't find a play clear enough to grade. Try a link that starts closer to the action.");
          return;
        }
        const detectedSport = sport || parsed.find(p => p.sport)?.sport || profile.sport || "Unknown";
        const myPlayer = findMyPlayer(parsed, profile.jersey, teamColor);
        setDecisions(parsed); setResultMode("clip");
        const clipReview: Review = {
          id: crypto.randomUUID(), fileName: videoTitle, sport: detectedSport, mode: "clip",
          grade: myPlayer?.grade ?? "N/A", timestamp: Date.now(), decisions: parsed,
          teamId: linkedTeamId || null, opponentName: opponentName.trim() || null,
          gameType: linkedTeamId ? gameType : null, gameDate: linkedTeamId && gameDate ? gameDate : null,
          thumbnailUrl, teamColor: teamColor.trim() || null,
        };
        saveReviews([clipReview, ...reviews]);
        persistReview(userId, clipReview);
      } else {
        const report = parseGameReport(data.report ?? "");
        const chunkTexts = [data.chunkText ?? ""];
        report.boxScore = buildBoxScore(chunkTexts);
        report.volleyBox = buildVolleyBoxScore(chunkTexts);
        report.timeline = buildDecisionTimeline(chunkTexts);
        if (isEmptyGameReport(report)) {
          setYtError("We watched the video but couldn't pull a usable game report out of it. Try Start screen capture instead.");
          return;
        }
        setGameReport(report); setResultMode("game");
        const myGrade = (data.report ?? "").match(/Your Grade:\s*([A-F][+-]?)/i)?.[1];
        const gameReview: Review = {
          id: crypto.randomUUID(), fileName: videoTitle,
          sport: sport || profile.sport || "Unknown", mode: "game",
          grade: myGrade ?? report.overallGrade, timestamp: Date.now(), gameReport: report,
          teamId: linkedTeamId || null, opponentName: opponentName.trim() || null,
          gameType: linkedTeamId ? gameType : null, gameDate: linkedTeamId && gameDate ? gameDate : null,
          thumbnailUrl, teamColor: teamColor.trim() || null,
        };
        saveReviews([gameReview, ...reviews]);
        persistReview(userId, gameReview);
      }
    } catch (err) {
      console.error(err);
      setYtError("Something went wrong analyzing that link. Try Start screen capture instead.");
    } finally {
      // Several branches above return early (queued game, limit hit, error) —
      // without finally they skipped this and left the page stuck on
      // "Watching your film…" even though the job was running fine.
      setLoading(false); setProgressLabel("");
    }
  }

  // Returns true if blocked (caller should stop). Non-incrementing courtesy
  // pre-check so we can show the upgrade modal before doing any work; the
  // authoritative gate lives server-side. Fails OPEN on a network error — a
  // transient /api/usage blip shouldn't strand a user.
  async function usageBlocked(mode: "clip" | "game"): Promise<boolean> {
    if (!userId) return false;
    try {
      const check = await fetch(`/api/usage?kind=${mode}`).then(r => r.json());
      if (check && check.ok === false) { onShowUpgrade?.(); return true; }
    } catch { /* fail open */ }
    return false;
  }

  async function runAnalysis(frames: { dataUrl: string; timestamp: number }[], mode: "clip" | "game", videoTitle: string, lenient = false) {
    if (await usageBlocked(mode)) { setLoading(false); setProgressLabel(""); return; }
    if (mode === "clip") {
      setProgressLabel("Analyzing players…"); setProgressTotal(1);
      const [res, thumbnailUrl] = await Promise.all([
        fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sport: sport || profile.sport, frames: frames.map(f => f.dataUrl), mode: "clip", jersey: profile.jersey, teamColor, teamsNote, lenient }) }),
        captureThumbnail(frames),
      ]);
      const data = await res.json().catch(() => ({}));
      if (res.status === 403 && data.error === "limit_reached") { onShowUpgrade?.(); return; }
      if (data.error) throw new Error(data.error);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setProgressCurrent(1);
      const parsed        = parsePlayerBlocks(data.feedback ?? "");
      const detectedSport = sport || parsed.find(p => p.sport)?.sport || profile.sport || "Unknown";
      const myPlayer = findMyPlayer(parsed, profile.jersey, teamColor);
      setDecisions(parsed); setResultMode("clip");
      const clipReview: Review = {
        id: crypto.randomUUID(), fileName: videoTitle, sport: detectedSport, mode: "clip",
        // Only record a grade when we actually matched THIS athlete (jersey +
        // team color). Falling back to parsed[0] would silently grade the user
        // on a random player — often an opponent — and poison their average.
        grade: myPlayer?.grade ?? "N/A", timestamp: Date.now(), decisions: parsed,
        teamId: linkedTeamId || null, opponentName: opponentName.trim() || null,
        gameType: linkedTeamId ? gameType : null, gameDate: linkedTeamId && gameDate ? gameDate : null,
        thumbnailUrl, teamColor: teamColor.trim() || null,
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
      const [, thumbnailUrl] = await Promise.all([
        Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker)),
        captureThumbnail(frames),
      ]);
      setProgressLabel("Building game report…");
      const synthRes  = await fetch("/api/synthesize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sport: sport || profile.sport, chunkSummaries, teamsNote, jersey: profile.jersey, teamColor }) });
      if (!synthRes.ok) throw new Error(`Server error ${synthRes.status} on synthesis`);
      const synthData = await synthRes.json();
      if (synthData.error) throw new Error(synthData.error);
      setProgressCurrent(chunks.length + 1);
      const report = parseGameReport(synthData.report ?? "");
      const chunkTexts = chunkSummaries.map(c => c.text);
      report.boxScore = buildBoxScore(chunkTexts);
      report.volleyBox = buildVolleyBoxScore(chunkTexts);
      report.timeline = buildDecisionTimeline(chunkTexts);
      const detectedGameSport = sport || profile.sport || "Unknown";
      setGameReport(report); setResultMode("game");
      // Library tracks YOUR grade when the report identified you, not the whole game's
      const myGrade = (synthData.report ?? "").match(/Your Grade:\s*([A-F][+-]?)/i)?.[1];
      const gameReview: Review = {
        id: crypto.randomUUID(), fileName: videoTitle, sport: detectedGameSport, mode: "game",
        grade: myGrade ?? report.overallGrade, timestamp: Date.now(), gameReport: report,
        teamId: linkedTeamId || null, opponentName: opponentName.trim() || null,
        gameType: linkedTeamId ? gameType : null, gameDate: linkedTeamId && gameDate ? gameDate : null,
        thumbnailUrl, teamColor: teamColor.trim() || null,
      };
      saveReviews([gameReview, ...reviews]);
      persistReview(userId, gameReview);
    }
  }

  async function runBackgroundGameJob(frames: { dataUrl: string; timestamp: number }[], videoTitle: string, lenient: boolean) {
    setProgressLabel("Starting background analysis…"); setProgressTotal(frames.length);
    const detectedGameSport = sport || profile.sport || "Unknown";
    const thumbnailUrl = await captureThumbnail(frames);
    const startRes = await fetch("/api/jobs/start", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: videoTitle, sport: detectedGameSport,
        teamId: linkedTeamId || null, opponentName: opponentName.trim() || null,
        gameType: linkedTeamId ? gameType : null, gameDate: linkedTeamId && gameDate ? gameDate : null,
        thumbnailUrl,
      }),
    });
    const startData = await startRes.json().catch(() => ({}));
    if (startRes.status === 403 && startData.error === "limit_reached") { setLoading(false); setProgressLabel(""); onShowUpgrade?.(); return; }
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
        frameCount: frames.length, timestamps: frames.map(f => f.timestamp),
        jersey: profile.jersey, teamColor, teamsNote, lenient,
      }),
    });
    const finalizeData = await finalizeRes.json().catch(() => ({}));
    if (finalizeData.error) throw new Error(finalizeData.error);
    if (!finalizeRes.ok) throw new Error(`Server error ${finalizeRes.status} queuing analysis`);

    setJobStarted(true);
    setActiveJobId(jobId);
  }

  async function analyzeVideo(lenient = false) {
    if (!videoFile) return;

    setLoading(true); setDecisions([]); setGameReport(null); setResultMode(null); setJobStarted(false); setActiveJobId(null);
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

  // For clips, the headline grade is YOUR grade — only shown when we actually
  // identified this athlete by jersey. Otherwise "N/A": showing another
  // player's grade as if it were yours is worse than showing nothing.
  const myClipPlayer = resultMode === "clip" ? findMyPlayer(decisions, profile.jersey, teamColor) : null;
  const overallGrade = resultMode === "game" ? gameReport?.overallGrade ?? "N/A" : myClipPlayer?.grade ?? "N/A";

  // Signed-in users need Jersey Color + Team + Opponent set before analyzing
  // real team-game footage — matches HoopIQ's structured intake. This only
  // applies when the upload IS a team game: a random 1v1 or drill clip has
  // no "opponent" to speak of, so isGameFootage lets the uploader say so and
  // skip the requirement entirely. Guests keep the old unrestricted flow
  // regardless — they have no account to attach a team to, so gating on it
  // would just block the entire "Try free" onboarding path.
  const needsTeamInfo = !!userId && isGameFootage;
  const canAnalyze = !needsTeamInfo || (!!linkedTeamId && !!opponentName.trim() && !!teamColor.trim());

  const gameFootageToggle = !!userId && (
    <Segmented stretch value={isGameFootage ? "game" : "clip"} onChange={v => setIsGameFootage(v === "game")}
      options={[{ value: "game", label: "Full game" }, { value: "clip", label: "Just a clip" }]} />
  );

  const teamLinkingFields = needsTeamInfo && (
    myTeams.length === 0 ? (
      <div className="rounded-2xl bg-muted p-4 text-center">
        <p className="text-sm text-foreground">You need a team before you can analyze film.</p>
        <button onClick={() => document.querySelector<HTMLButtonElement>("[data-module='teams']")?.click()}
          className="btn-pill btn-dark mt-2 px-4 py-2 text-xs">
          Create a team
        </button>
      </div>
    ) : (
      <div className="space-y-2 rounded-2xl bg-muted p-3">
        <p className="px-1 text-[12px] text-muted-foreground">Team and opponent (required)</p>
        <select
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
          value={linkedTeamId}
          onChange={e => setLinkedTeamId(e.target.value)}>
          <option value="">Select your team…</option>
          {myTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <input
            className="rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            placeholder="Opponent"
            value={opponentName}
            onChange={e => setOpponentName(e.target.value)}
          />
          <select
            className="rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            value={gameType}
            onChange={e => setGameType(e.target.value)}>
            <option value="Game">Game</option>
            <option value="Practice">Practice</option>
            <option value="Scrimmage">Scrimmage</option>
          </select>
          <input type="date"
            className="col-span-2 rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            value={gameDate}
            onChange={e => setGameDate(e.target.value)}
          />
        </div>
      </div>
    )
  );

  return (
    <div className="space-y-5">

      {/* Upload + Results */}
      <div className="grid gap-5 lg:grid-cols-2">

        {/* Upload */}
        <div className="surface p-5">
          <p className="mb-4 font-display text-xl">Add film</p>

          <Segmented stretch className="mb-5" value={inputTab} onChange={t => { setInputTab(t); setYtError(""); }}
            options={[{ value: "youtube", label: "Paste a link" }, { value: "file", label: "Upload a file" }]} />

          {inputTab === "file" ? (
            <>
              <label className="group block cursor-pointer rounded-2xl border border-dashed border-input p-8 text-center transition-colors hover:border-ring hover:bg-muted/40">
                <input type="file" accept="video/*" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0]; if (!file) return;
                  setVideoFile(file); setFileName(file.name); setClipTitle(""); setTeamColor(profile.teamColor || "");
                  setVideoUrl(URL.createObjectURL(file));
                  setDecisions([]); setGameReport(null); setResultMode(null);
                }} />
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-accent/80 transition-transform group-hover:scale-110"><Clapperboard className="h-6 w-6 text-foreground" strokeWidth={1.75} /></div>
                <p className="text-sm font-bold text-foreground">Tap to choose video</p>
                <p className="mt-1 text-xs text-muted-foreground">Clip or full game — adapts automatically</p>
              </label>
              {videoUrl && <video className="mt-4 w-full rounded-lg border border-border" src={videoUrl} controls />}
              {fileName && <p className="mt-2 text-xs text-muted-foreground truncate">{fileName}</p>}
              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <Lock className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} />
                Your video never leaves your device. Only still frames are sent for analysis, then deleted.
              </p>
            </>
          ) : (
            <div className="space-y-3">
              {capturing ? (
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-5 text-center">
                  <div className="mb-2 flex items-center justify-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    </span>
                    <p className="text-sm font-bold text-foreground">Capturing your film</p>
                  </div>
                  <p className="text-3xl font-semibold text-foreground">
                    {captureCount} <span className="text-base font-semibold text-muted-foreground">frames</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatTime(captureSecs)} captured · play at 2x speed to finish sooner
                  </p>
                  <button
                    onClick={() => { stopCaptureRef.current = true; }}
                    className="btn-pill btn-dark mt-4 w-full py-3.5 text-base">
                    Stop &amp; analyze
                  </button>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    Switch to your film tab and let it play. Come back here and hit stop when the play is over.
                  </p>
                </div>
              ) : (
                <>
                  {/* Primary: paste a link. Gemini reads public YouTube
                      natively, so this is now the fastest path to a report. */}
                  <div>
                    <p className="text-[15px] text-foreground">Paste your film link</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      We watch the video and grade it. Nothing to download, record, or upload. Works on <span className="font-semibold text-foreground">public</span> YouTube videos.
                    </p>
                    <input
                      className="mt-3 w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 transition-shadow"
                      placeholder="https://youtube.com/watch?v=..."
                      value={ytUrl}
                      onChange={e => { setYtUrl(e.target.value); setYtError(""); }}
                    />
                  </div>

                  <input
                    className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 transition-shadow"
                    placeholder={profile.sport ? `Sport (${profile.sport})` : "Sport (optional)"}
                    value={sport}
                    onChange={e => setSport(e.target.value)}
                  />
                  {gameFootageToggle}
                  {needsTeamInfo && (
                    <input
                      className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 transition-shadow"
                      placeholder={profile.jersey ? `Your jersey color (required) — you're #${profile.jersey}` : "Your jersey color this game (required)"}
                      value={teamColor}
                      onChange={e => setTeamColor(e.target.value)}
                    />
                  )}
                  {teamLinkingFields}

                  <button
                    onClick={() => analyzeYouTube()}
                    disabled={loading || !ytUrl.trim() || !canAnalyze}
                    className="btn-pill btn-dark w-full py-3.5 text-base disabled:opacity-40">
                    {loading ? "Watching your film…" : "Analyze this link"}
                  </button>

                  {/* Fallback for film the link path can't reach: unlisted
                      YouTube, HUDL, anything behind a login. */}
                  {screenCaptureSupported() ? (
                    <details className="rounded-2xl bg-muted px-4 py-3">
                      <summary className="cursor-pointer text-[13px] text-muted-foreground">
                        Film not on public YouTube? Capture your screen instead
                      </summary>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        For unlisted videos, HUDL, or anything behind a login. Open your film in another tab, start the capture, pick that tab, and press play — 2x speed works. Hit stop when the play is over.
                      </p>
                      <button
                        onClick={() => startScreenCapture()}
                        disabled={loading || !canAnalyze}
                        className="btn-pill btn-light mt-2.5 w-full py-2.5 text-sm disabled:opacity-40">
                        Start screen capture
                      </button>
                    </details>
                  ) : (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      If your film isn&apos;t on public YouTube, use the Upload tab — screen capture needs a laptop or desktop.
                    </p>
                  )}
                </>
              )}

              {ytError && (
                <div className="rounded-lg border border-red-500/25 bg-red-500/[0.07] px-4 py-3">
                  <p className="text-sm text-red-600 dark:text-red-400">{ytError}</p>
                  <Button variant="secondary" size="sm" className="mt-2.5"
                    onClick={() => { setInputTab("file"); setYtError(""); }}>
                    <Upload className="h-3.5 w-3.5" /> Switch to file upload
                  </Button>
                </div>
              )}
            </div>
          )}

          {inputTab === "file" && (
            <div className="mt-4 space-y-3">
              {videoFile && (
                <>
                  <input
                    className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 transition-shadow"
                    placeholder="Name this clip (e.g. Playoff game vs Lincoln)"
                    value={clipTitle}
                    onChange={e => setClipTitle(e.target.value)}
                  />
                  {gameFootageToggle}
                  <input
                    className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 transition-shadow"
                    placeholder={(needsTeamInfo ? "Your jersey color (required) — " : "") + (profile.jersey ? `Your jersey color this game (e.g. White, Blue) — you're #${profile.jersey}` : "Your jersey color this game (e.g. White, Blue, Red)")}
                    value={teamColor}
                    onChange={e => setTeamColor(e.target.value)}
                  />
                  <input
                    className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 transition-shadow"
                    placeholder="Describe the teams if jerseys are mixed (e.g. 'my team: white + blue pinnies, them: all black')"
                    value={teamsNote}
                    onChange={e => setTeamsNote(e.target.value)}
                  />
                  {teamLinkingFields}
                </>
              )}
              <input
                className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 transition-shadow"
                placeholder={profile.sport ? `Sport (${profile.sport})` : "Sport (optional)"}
                value={sport}
                onChange={e => setSport(e.target.value)}
              />
              <button
                onClick={() => analyzeVideo()}
                disabled={loading || !videoFile || !canAnalyze}
                className="btn-pill btn-dark w-full py-4 text-sm disabled:opacity-30"
              >
                {loading ? "Analyzing…" : "Analyze Film"}
              </button>
            </div>
          )}
        </div>

        {/* Results */}
        <div className="surface p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-xl text-foreground">
                {resultMode === "game" ? "Game report" : "Player decisions"}
              </p>
              {resultMode === "clip" && !loading && decisions.length > 0 && !myClipPlayer && (
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  Couldn&apos;t match your jersey in this clip, so no grade was saved for you — every player below is still graded.
                </p>
              )}
            </div>
            {resultMode && !loading && !(resultMode === "clip" && decisions.length === 0) && (
              <GradeBadge grade={overallGrade} large />
            )}
          </div>

          {loading && (
            <AnalysisLoader label={progressLabel} current={progressCurrent} total={progressTotal} />
          )}

          {!loading && jobStarted && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] p-8 text-center">
              <Clapperboard className="h-8 w-8 text-emerald-600 dark:text-emerald-400" strokeWidth={1.5} />
              {activeJob?.status === "complete" ? (<>
                <p className="text-base font-semibold text-foreground">Your game review is ready</p>
                <button onClick={() => document.querySelector<HTMLButtonElement>("[data-module='library']")?.click()}
                  className="btn-pill btn-dark px-6 py-2.5 text-sm">
                  Open in Library
                </button>
              </>) : activeJob?.status === "failed" ? (<>
                <p className="text-base font-semibold text-foreground">Analysis failed</p>
                <p className="text-sm text-red-600 dark:text-red-400 max-w-sm leading-relaxed">{activeJob.error || "Something went wrong. Your game credit was refunded."}</p>
              </>) : (<>
                <p className="text-base font-semibold text-foreground">Analyzing your game</p>
                <div className="w-full max-w-sm">
                  <JobProgressBar job={activeJob ?? { status: "queued", progress_label: null, progress_current: 0, progress_total: 0 }} />
                </div>
                <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
                  A full game takes about 4–5 minutes. It runs in the background, so you can close this tab. The finished review lands in your Library.
                </p>
              </>)}
            </div>
          )}

          {!loading && !jobStarted && analyzeError && (
            <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-red-500/25 bg-red-500/[0.07] p-6 text-center">
              <AlertTriangle className="h-7 w-7 text-red-600 dark:text-red-400" strokeWidth={1.75} />
              <p className="text-sm text-red-600 dark:text-red-400">{analyzeError}</p>
              {pendingRetry && (
                <button onClick={pendingRetry}
                  className="btn-pill btn-dark px-6 py-2.5 text-sm">
                  Try again
                </button>
              )}
            </div>
          )}

          {!loading && !analyzeError && !resultMode && !jobStarted && (
            <div className="rounded-lg border border-dashed border-border p-5">
              <p className="mb-4 text-xs text-muted-foreground">
                {profile.name ? `Ready when you are, ${profile.name.split(" ")[0]} — here's what a review looks like:` : "Upload a clip and every player gets a card like this:"}
              </p>
              {/* Ghost preview of a graded player card */}
              <div className="pointer-events-none select-none space-y-2 opacity-60">
                <div className="surface p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500 text-lg font-semibold text-foreground">A-</div>
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-foreground">White #23 Point Guard</div>
                      <div className="text-xs text-muted-foreground">Drive-and-kick read</div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg bg-muted p-2.5">
                      <div className="text-[12px] text-muted-foreground mb-1">What Happened</div>
                      <div className="text-xs text-muted-foreground">Drew two defenders on the drive, kicked to the open corner.</div>
                    </div>
                    <div className="rounded-lg bg-muted p-2.5">
                      <div className="text-[12px] text-muted-foreground mb-1">Next Time</div>
                      <div className="text-xs text-muted-foreground">Same read, half a beat earlier — before help commits.</div>
                    </div>
                  </div>
                </div>
                <div className="surface flex items-center gap-3 px-4 py-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400 text-sm font-semibold text-primary-foreground">C+</div>
                  <div className="text-sm font-semibold text-muted-foreground">Blue #11 Help Defender</div>
                </div>
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
            </div>
          )}

          {!loading && ((resultMode === "clip" && decisions.length === 0) || (resultMode === "game" && isEmptyGameReport(gameReport))) && (
            <div className="surface flex flex-col items-center justify-center gap-3 text-center px-6 py-10">
              <VideoOff className="h-9 w-9 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-base font-semibold text-foreground">This clip was a little too unclear to break down</p>
              <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
                Nothing's broken — the analysis ran fine, but the footage was too blurry, too far away, or too fast to read the plays confidently. We'd rather tell you that than make something up.
              </p>
              <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
                Try a clearer clip where the players and the ball are clearly visible — closer footage and steady framing work best.
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <button onClick={() => (videoFile ? analyzeVideo(true) : analyzeYouTube(true))}
                  className="btn-pill btn-dark px-5 py-2.5 text-sm">
                  Analyze anyway
                </button>
                <button onClick={() => {
                    setVideoFile(null); setVideoUrl(""); setFileName(""); setClipTitle(""); setTeamColor("");
                    setDecisions([]); setGameReport(null); setResultMode(null);
                  }}
                  className="btn-pill btn-light px-5 py-2.5 text-sm">
                  Try another clip
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">"Analyze anyway" gives a best-effort read — uncertain calls are marked low confidence.</p>
            </div>
          )}
          {!loading && resultMode === "clip" && decisions.length > 0 && (
            <>
              {youtubeIdFrom(ytUrl) && decisions.some(d => d.timestamp) && (
                <button onClick={() => setClipFilmRoom(true)}
                  className="btn-pill btn-dark mb-3 w-full py-3 text-sm">
                  Watch with analysis
                </button>
              )}
              <PlayerCardList decisions={decisions} />
            </>
          )}
          {clipFilmRoom && youtubeIdFrom(ytUrl) && (
            <FilmRoom videoId={youtubeIdFrom(ytUrl)!} decisions={decisions} onClose={() => setClipFilmRoom(false)} />
          )}
          {!loading && resultMode === "game" && gameReport && !isEmptyGameReport(gameReport) && (
            <GameResultsView report={gameReport}
              sourceName={ytUrl.trim() ? `YouTube: ${ytUrl.trim()}` : undefined}
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
  team_id: string | null; opponent_name: string | null; thumbnail_url: string | null; created_at: string;
};

export function FilmLibrary({ reviews, onReviewsChange, userId }: {
  reviews: Review[];
  onReviewsChange: (r: Review[]) => void;
  userId?: string;
}) {
  const [openReview,  setOpenReview]  = useState<Review | null>(null);
  const [search,      setSearch]      = useState("");
  const [modeFilter,  setModeFilter]  = useState<"all" | "clip" | "game">("all");
  const [gradeFilter, setGradeFilter] = useState<"all" | "good" | "mid" | "poor">("all");
  const [sharing,     setSharing]     = useState<string | null>(null);
  const [renamingId,  setRenamingId]  = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [collapsed,   setCollapsed]   = useState<Set<string>>(new Set());
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
              gameDate: row.game_date, location: row.location, thumbnailUrl: row.thumbnail_url,
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
  function deleteReview(id: string) { saveReviews(reviews.filter(r => r.id !== id)); setOpenReview(null); deleteReviewRemote(userId, id); }
  function startRename(review: Review) { setRenamingId(review.id); setRenameValue(review.fileName); }
  function commitRename() {
    if (renamingId) {
      const trimmed = renameValue.trim();
      saveReviews(reviews.map(r => r.id === renamingId ? { ...r, fileName: trimmed || r.fileName } : r));
      const original = reviews.find(r => r.id === renamingId);
      if (trimmed && original && trimmed !== original.fileName) renameReviewRemote(userId, renamingId, trimmed);
    }
    setRenamingId(null);
  }
  function toggleTeam(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

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
      const team = r.teamId ? myTeams.find(t => t.id === r.teamId)?.name ?? "" : "";
      if (![r.sport, r.fileName, r.opponentName ?? "", team].some(x => x.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  async function handleShareReview(review: Review) {
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
        <div key={job.id} className="flex items-center gap-3 rounded-lg border border-border bg-muted px-4 py-3">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{job.file_name || "Untitled game"}</p>
            <div className="mt-1.5"><JobProgressBar job={job} compact /></div>
          </div>
        </div>
      ))}
      {failedJobs.map(job => (
        <div key={job.id} className="rounded-lg border border-red-500/25 bg-red-500/[0.07] px-4 py-3">
          <p className="text-sm font-semibold text-foreground">{job.file_name || "Untitled game"} — analysis failed</p>
          <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{job.error || "Something went wrong."}</p>
        </div>
      ))}
    </div>
  );

  // Empty state — no reviews at all (still shows in-progress jobs, if any)
  if (reviews.length === 0) {
    return (
      <div>
        {jobsPanel}
        <div className="surface p-10 flex flex-col items-center justify-center text-center gap-4">
          <Clapperboard className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
          <div>
            <p className="text-base font-semibold text-foreground mb-1">No film yet</p>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
              Upload your first clip in DecisionIQ and it'll show up here with your grade, breakdown, and feedback.
            </p>
          </div>
          <a href="#" onClick={e => { e.preventDefault(); document.querySelector<HTMLButtonElement>("[data-module='decision']")?.click(); }}
            className="btn-pill btn-dark px-6 py-2.5 text-sm">
            Go to DecisionIQ
          </a>
        </div>
      </div>
    );
  }

  // Group reviews (and in-flight jobs) into collapsible team sections, plus an
  // "Unassigned" catch-all for anything not linked to a team — mirrors HoopIQ's
  // My Games layout.
  const filtersActive = modeFilter !== "all" || gradeFilter !== "all" || search.trim() !== "";
  const teamNameById = new Map(myTeams.map(t => [t.id, t.name]));
  type Group = { key: string; name: string; teamId: string | null; reviews: Review[]; jobs: AnalysisJob[]; latest: number };
  const groupMap = new Map<string, Group>();
  const ensureGroup = (teamId: string | null) => {
    const key = teamId || "__unassigned__";
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key, teamId, reviews: [], jobs: [], latest: 0,
        name: teamId ? (teamNameById.get(teamId) || "Team") : "Unassigned",
      });
    }
    return groupMap.get(key)!;
  };
  // Newest game first within each team — by the game's own date when set.
  for (const r of [...filtered].sort((a, b) => playedAt(b) - playedAt(a))) {
    const g = ensureGroup(r.teamId || null);
    g.reviews.push(r);
    g.latest = Math.max(g.latest, r.timestamp);
  }
  if (!filtersActive) {
    for (const j of [...activeJobs, ...failedJobs]) {
      const g = ensureGroup(j.team_id || null);
      g.jobs.push(j);
      g.latest = Math.max(g.latest, new Date(j.created_at).getTime() || Date.now());
    }
  }
  const groups = [...groupMap.values()].sort((a, b) => {
    if (a.key === "__unassigned__") return 1;
    if (b.key === "__unassigned__") return -1;
    return b.latest - a.latest;
  });

  const dateLabel = (r: Review) => {
    const base = r.gameDate
      ? new Date(playedAt(r)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : formatDate(r.timestamp);
    return r.gameType ? `${base} · ${r.gameType}` : base;
  };

  const gameCount = reviews.filter(r => r.mode === "game").length;
  return (
    <div>
      {/* Toolbar: search, type, grade — one row */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search team, opponent, or title…"
          className="min-w-0 flex-1 basis-56 rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 transition-shadow"
        />
        <Segmented value={modeFilter} onChange={setModeFilter} options={[
          { value: "all", label: "All", count: reviews.length },
          { value: "game", label: "Games", count: gameCount },
          { value: "clip", label: "Clips", count: reviews.length - gameCount },
        ]} />
        <select value={gradeFilter} onChange={e => setGradeFilter(e.target.value as typeof gradeFilter)}
          aria-label="Filter by grade"
          className="rounded-lg border border-border bg-background px-2.5 py-2 text-xs font-semibold text-foreground focus:outline-none focus:border-ring">
          <option value="all">Any grade</option>
          <option value="good">B+ and up</option>
          <option value="mid">C to B</option>
          <option value="poor">Below C</option>
        </select>
      </div>

      {groups.length === 0 ? (
        <p className="border-t border-border py-10 text-center text-sm text-muted-foreground">No reviews match your filters.</p>
      ) : (
        <div className="space-y-8">
          {groups.map(group => {
            const isCollapsed = collapsed.has(group.key);
            // Best-effort record from this team's linked games.
            let wins = 0, losses = 0;
            for (const r of group.reviews) {
              const res = gameResult(r, group.name === "Unassigned" ? null : group.name);
              if (res?.outcome === "W") wins++;
              else if (res?.outcome === "L") losses++;
            }
            const record = wins + losses > 0 ? `${wins}-${losses}` : null;
            const games = group.reviews.filter(r => r.mode === "game").length + group.jobs.length;
            const clips = group.reviews.length - group.reviews.filter(r => r.mode === "game").length;
            const subtitle = [games && `${games} ${games === 1 ? "game" : "games"}`, clips && `${clips} ${clips === 1 ? "clip" : "clips"}`].filter(Boolean).join(" · ");
            return (
              <section key={group.key} className="border-t border-border pt-2">
                <TeamSectionHeader
                  name={group.name}
                  initials={group.teamId ? teamInitials(group.name) : "—"}
                  colorClass={group.teamId ? teamAvatarColor(group.key) : "bg-muted-foreground"}
                  subtitle={subtitle}
                  record={record}
                  recordTone={record ? (wins >= losses ? "win" : "loss") : "neutral"}
                  open={!isCollapsed}
                  onToggle={() => toggleTeam(group.key)}
                />
                {!isCollapsed && (
                  <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {group.jobs.map(job => (
                      <GameCard
                        key={job.id}
                        thumbnailUrl={job.thumbnail_url}
                        sport={job.sport || ""}
                        dateLabel={job.opponent_name ? `vs ${job.opponent_name}` : "Processing"}
                        title={job.file_name || "Untitled game"}
                        status={job.status === "failed"
                          ? { label: "Failed", tone: "failed" }
                          : { label: job.progress_label || "Analyzing…", tone: "processing" }}
                      />
                    ))}
                    {group.reviews.map(review => (
                      <GameCard
                        key={review.id}
                        thumbnailUrl={review.thumbnailUrl}
                        sport={review.sport}
                        dateLabel={dateLabel(review)}
                        title={review.opponentName ? `vs ${review.opponentName}` : (review.fileName || review.sport)}
                        grade={review.grade}
                        result={gameResult(review, group.name === "Unassigned" ? null : group.name)}
                        onClick={() => setOpenReview(review)}
                        menu={
                          <ReviewMenu
                            review={review}
                            teams={myTeams}
                            sharing={sharing === review.id}
                            onOpen={() => setOpenReview(review)}
                            onRename={() => startRename(review)}
                            onShare={() => handleShareReview(review)}
                            onLinkTeam={(teamId) => linkReviewToTeam(review.id, teamId)}
                            onDelete={() => deleteReview(review.id)}
                          />
                        }
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Rename modal */}
      {renamingId && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={() => setRenamingId(null)}>
          <div className="surface w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <p className="mb-3 text-sm font-bold text-foreground">Rename</p>
            <input
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null); }}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
            <div className="mt-4 flex gap-2">
              <button onClick={() => setRenamingId(null)} className="flex-1 rounded-lg border border-border py-2 text-sm font-semibold text-foreground hover:bg-muted">Cancel</button>
              <button onClick={commitRename} className="btn-pill btn-dark flex-1 py-2 text-sm">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Review detail overlay */}
      {openReview && (
        openReview.mode === "game" && openReview.gameReport
          ? <GameResultsView report={openReview.gameReport} onClose={() => setOpenReview(null)} backLabel="Back to library" sourceName={openReview.fileName} />
          : (
            <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
              <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6">
                <div className="flex items-center justify-between">
                  <button onClick={() => setOpenReview(null)}
                    className="btn-pill btn-light px-3 py-1.5 text-xs">
                    ← Back to library
                  </button>
                  <p className="truncate px-3 text-sm font-semibold text-foreground">{openReview.fileName || openReview.sport}</p>
                  <button onClick={() => setOpenReview(null)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
                </div>
                {openReview.mode === "clip" && openReview.decisions
                  ? <PlayerCardList decisions={openReview.decisions} />
                  : <p className="text-sm text-muted-foreground">No data saved for this review.</p>}
              </div>
            </div>
          )
      )}
    </div>
  );
}

// Overflow (⋮) menu for a game card in the Film Library.
function ReviewMenu({ review, teams, sharing, onOpen, onRename, onShare, onLinkTeam, onDelete }: {
  review: Review;
  teams: { id: string; name: string }[];
  sharing: boolean;
  onOpen: () => void;
  onRename: () => void;
  onShare: () => void;
  onLinkTeam: (teamId: string) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);
  return (
    <div className="relative shrink-0">
      <button onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 bottom-full mb-1 z-30 w-44 overflow-hidden rounded-lg border border-border bg-muted py-1 shadow-xl"
          onClick={e => e.stopPropagation()}>
          <button onClick={() => { setOpen(false); onOpen(); }} className="block w-full px-3 py-2 text-left text-xs font-semibold text-foreground hover:bg-accent">Open report</button>
          <button onClick={() => { setOpen(false); onRename(); }} className="block w-full px-3 py-2 text-left text-xs font-semibold text-foreground hover:bg-accent">Rename</button>
          <button onClick={() => { setOpen(false); onShare(); }} disabled={sharing} className="block w-full px-3 py-2 text-left text-xs font-semibold text-foreground hover:bg-accent disabled:opacity-40">{sharing ? "Sharing…" : "Share"}</button>
          {teams.length > 0 && (
            <div className="border-t border-border">
              <p className="px-3 pb-1 pt-2 text-[12px] text-muted-foreground">Move to team</p>
              <select
                value={review.teamId || ""}
                onChange={e => { onLinkTeam(e.target.value); setOpen(false); }}
                className="mx-2 mb-1 w-[calc(100%-1rem)] rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none">
                <option value="">Unassigned</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          <div className="border-t border-border">
            <button onClick={() => { setOpen(false); onDelete(); }} className="block w-full px-3 py-2 text-left text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-950/40">Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}
