"use client";

import { useState } from "react";
import type { Profile, Review, PlayerDecision, GameReport, ChunkSummary, PlayerStat } from "../lib/types";
import { gradeClass, formatTime, formatDate, TEAM_PALETTE, extractTeamName, buildTeamColorMap } from "../lib/decisioniq-helpers";

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
    .filter(l => l && !l.toLowerCase().includes("no jersey"))
    .map(l => ({ label: l.match(/^(#\d+[^|]*)/)?.[1]?.trim() ?? l.slice(0, 20), raw: l }));
  return {
    overallGrade: extractGrade(text),
    gameSummary: extract("Game Summary"), periodBreakdown: extract("Period Breakdown"),
    foulPatterns: extract("Foul & Call Patterns"), decisionTrends: extract("Decision Trends"),
    strengths: extractList("Top 3 Strengths"), improvements: extractList("Top 3 Areas To Improve"),
    practiceFocus: extract("Game-Level Practice Focus"), playerStats,
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
        const cap = Math.min(duration, 30);
        timestamps = [0.5, cap * 0.2, cap * 0.4, cap * 0.6, cap * 0.8, Math.max(cap - 0.5, 0.5)];
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
  headline: string; insight: string;
}) {
  const W = 800, H = 420;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Background
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, W, H);

  // Subtle grid lines
  ctx.strokeStyle = "#18181b";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // Grade pill
  const gradeColor = GRADE_COLOR[opts.grade] ?? "#71717a";
  const gradeX = 56, gradeY = 56;
  const gradeW = 96, gradeH = 56;
  ctx.fillStyle = gradeColor + "22";
  ctx.beginPath(); ctx.roundRect(gradeX, gradeY, gradeW, gradeH, 10); ctx.fill();
  ctx.font = "bold 36px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = gradeColor;
  ctx.textAlign = "center";
  ctx.fillText(opts.grade, gradeX + gradeW / 2, gradeY + gradeH - 13);

  // Name
  ctx.textAlign = "left";
  ctx.font = "bold 28px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(opts.name || "Player", gradeX + gradeW + 20, gradeY + 30);

  // Sport / role
  ctx.font = "14px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#71717a";
  ctx.fillText([opts.sport, opts.role].filter(Boolean).join("  ·  "), gradeX + gradeW + 20, gradeY + 52);

  // Divider
  ctx.strokeStyle = "#27272a";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(56, 134); ctx.lineTo(W - 56, 134); ctx.stroke();

  // Headline
  ctx.font = "bold 15px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#a1a1aa";
  ctx.fillText("WHAT HAPPENED", 56, 168);
  ctx.font = "16px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#e4e4e7";
  wrapText(ctx, opts.headline, 56, 192, W - 112, 24, 3);

  // Insight
  ctx.font = "bold 15px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#a1a1aa";
  ctx.fillText("NEXT TIME", 56, 300);
  ctx.font = "16px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#e4e4e7";
  wrapText(ctx, opts.insight, 56, 324, W - 112, 24, 2);

  // Branding
  ctx.font = "bold 15px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "right";
  ctx.fillText("Reel", W - 56, H - 24);
  ctx.font = "13px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#3f3f46";
  ctx.fillText("getreelapp.vercel.app", W - 56, H - 44);

  // Border
  ctx.strokeStyle = "#27272a";
  ctx.lineWidth = 2;
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

  async function handleShare(e: React.MouseEvent) {
    e.stopPropagation();
    setSharing(true);
    await shareGradeCard({
      name: decision.player.replace(/\s*\([^)]*\)/, "").trim(),
      grade: decision.grade || "N/A",
      sport: decision.sport,
      role: decision.role,
      headline: decision.whatHappened,
      insight: decision.bestAlternative,
    });
    setSharing(false);
  }
  const grade       = decision.grade || "N/A";
  const displayTeam = decision.player.match(/\(([^)]+)\)/)?.[1] ?? null;

  return (
    <div className={`border border-zinc-800 bg-zinc-950 rounded-xl border-l-2 ${teamColor.border} overflow-hidden`}>
      <button onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <GradeBadge grade={grade} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-white">{decision.player || "Unknown Player"}</span>
            {displayTeam && (
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${teamColor.bg} text-white`}>{displayTeam}</span>
            )}
          </div>
          <p className="text-xs text-zinc-600 truncate mt-0.5">
            {[decision.role, decision.action, decision.sport].filter(Boolean).join("  ·  ")}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={handleShare} disabled={sharing}
            className="text-[10px] text-zinc-700 hover:text-zinc-400 transition-colors px-1 disabled:opacity-40">
            {sharing ? "…" : "SHARE"}
          </button>
          <span className="text-[10px] text-zinc-700">{open ? "HIDE" : "MORE"}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-zinc-800 px-4 py-4 grid gap-3 sm:grid-cols-2">
          {DECISION_FIELDS.map(({ key, label }) => {
            const val = decision[key];
            if (!val) return null;
            return (
              <div key={key} className="border border-zinc-800 rounded-lg p-3">
                <SectionLabel>{label}</SectionLabel>
                <p className="text-sm text-zinc-300 leading-relaxed">{val as string}</p>
              </div>
            );
          })}
          {decision.otherOptions.length > 0 && (
            <div className="border border-zinc-800 rounded-lg p-3 sm:col-span-2">
              <SectionLabel>Other Options</SectionLabel>
              <ul className="space-y-1.5">
                {decision.otherOptions.map((opt, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                    <span className="text-zinc-700 mt-0.5 shrink-0">–</span>{opt}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlayerCardList({ decisions }: { decisions: PlayerDecision[] }) {
  const colorMap = buildTeamColorMap(decisions);
  return (
    <div className="space-y-2">
      {decisions.map((d, i) => (
        <PlayerCard key={i} decision={d}
          teamColor={colorMap.get(extractTeamName(d.player)) ?? TEAM_PALETTE[0]}
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

      {report.playerStats.length > 0 && (
        <div className="border border-zinc-800 rounded-lg p-3">
          <SectionLabel>Player Stats</SectionLabel>
          <div className="space-y-2">
            {report.playerStats.map((p, i) => (
              <div key={i} className="border border-zinc-800 rounded-lg px-3 py-2.5">
                <p className="text-xs font-semibold text-white mb-0.5">{p.label}</p>
                <p className="text-xs text-zinc-500 leading-relaxed">{p.raw.replace(/^#\d+[^|]*\|\s*/, "")}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function DecisionIQ({ profile, reviews, onReviewsChange }: {
  profile: Profile; reviews: Review[]; onReviewsChange: (r: Review[]) => void;
}) {
  const [inputTab,   setInputTab]   = useState<"file" | "youtube">("file");
  const [fileName,   setFileName]   = useState("");
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
  async function extractFramesFromSheets(sheets: string[], rows: number, cols: number, frameWidth: number, frameHeight: number, frameCount: number): Promise<string[]> {
    const frames: string[] = [];
    const canvas = document.createElement("canvas");
    canvas.width = frameWidth;
    canvas.height = frameHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return frames;

    // Target ~24 frames spread across all sheets
    const totalFrames = Math.min(frameCount, sheets.length * rows * cols);
    const targetFrames = Math.min(24, totalFrames);
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
        data.sheets, data.rows, data.cols, data.frameWidth, data.frameHeight, data.frameCount
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
      const res  = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sport: sport || profile.sport, frames: frames.map(f => f.dataUrl), mode: "clip" }) });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setProgressCurrent(1);
      const parsed        = parsePlayerBlocks(data.feedback ?? "");
      const detectedSport = sport || parsed.find(p => p.sport)?.sport || profile.sport || "Unknown";
      setDecisions(parsed); setResultMode("clip");
      saveReviews([{ id: crypto.randomUUID(), fileName: videoTitle, sport: detectedSport, mode: "clip", grade: parsed[0]?.grade ?? "N/A", timestamp: Date.now(), decisions: parsed }, ...reviews]);
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
        const res  = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sport: sport || profile.sport, frames: chunk.map(f => f.dataUrl), mode: "game", chunkIndex: i, chunkStart: start, chunkEnd: end }) });
        if (!res.ok) throw new Error(`Server error ${res.status} on segment ${i + 1}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
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
    setLoading(true); setDecisions([]); setGameReport(null); setResultMode(null);
    setAnalyzeError(""); setPendingRetry(null);
    setProgressCurrent(0); setProgressTotal(0);
    const doAnalyze = async () => {
      setLoading(true); setAnalyzeError(""); setPendingRetry(null);
      setProgressCurrent(0); setProgressTotal(0);
      try {
        setProgressLabel("Extracting frames…");
        const { frames, mode } = await extractFramesAdaptive(videoFile!);
        await runAnalysis(frames, mode, fileName || "Untitled");
      } catch (err) {
        console.error(err);
        const msg = err instanceof Error ? err.message : "Something went wrong.";
        const isRateLimit = msg.includes("429") || msg.toLowerCase().includes("rate");
        setAnalyzeError(isRateLimit
          ? "Too many requests — the AI is busy. Wait a moment and try again."
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
                {tab === "file" ? "Video File" : "Screen Record"}
              </button>
            ))}
          </div>

          {inputTab === "file" ? (
            <>
              <label className="block cursor-pointer rounded-xl border-2 border-dashed border-zinc-800 p-8 text-center hover:border-zinc-600 active:border-zinc-500 transition-colors">
                <input type="file" accept="video/*" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0]; if (!file) return;
                  setVideoFile(file); setFileName(file.name);
                  setVideoUrl(URL.createObjectURL(file));
                  setDecisions([]); setGameReport(null); setResultMode(null);
                }} />
                <p className="text-3xl mb-2">🎬</p>
                <p className="text-sm font-semibold text-zinc-300">Tap to choose video</p>
                <p className="mt-1 text-xs text-zinc-600">Clip or full game. Adapts automatically.</p>
              </label>
              {videoUrl && <video className="mt-4 w-full rounded-lg border border-zinc-800" src={videoUrl} controls />}
              {fileName && <p className="mt-2 text-xs text-zinc-500 truncate">{fileName}</p>}
            </>
          ) : (
            <div className="rounded-lg border border-zinc-800 p-4 space-y-3">
              <p className="text-sm font-medium text-white">How to analyze a YouTube or online video</p>
              <div className="space-y-2">
                {[
                  { num: "1", text: "Open the video in YouTube, Twitter, or any browser" },
                  { num: "2", text: "Screen record the clip you want analyzed — Mac: Cmd+Shift+5 · iPhone: swipe up Control Center · Android: hold power button" },
                  { num: "3", text: 'Switch to the "Video File" tab and upload your recording' },
                ].map(s => (
                  <div key={s.num} className="flex items-start gap-3">
                    <span className="shrink-0 mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold text-zinc-400">{s.num}</span>
                    <p className="text-sm text-zinc-400">{s.text}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-zinc-600">Works on any device — no downloads or extensions needed.</p>
            </div>
          )}

          {inputTab === "file" && (
            <div className="mt-4 space-y-3">
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
            {resultMode && !loading && (
              <GradeBadge grade={overallGrade} large />
            )}
          </div>

          {loading && (
            <div className="space-y-4 py-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg border border-zinc-800 bg-black" />
              ))}
              <ProgressBar current={progressCurrent} total={progressTotal} label={progressLabel} />
            </div>
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

          {!loading && resultMode === "clip" && decisions.length > 0 && <PlayerCardList decisions={decisions} />}
          {!loading && resultMode === "game" && gameReport && <GameReportCard report={gameReport} />}
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

  function saveReviews(r: Review[]) { onReviewsChange(r); localStorage.setItem("decisioniq-reviews", JSON.stringify(r)); }
  function deleteReview(id: string) { saveReviews(reviews.filter(r => r.id !== id)); setExpandedReview(null); }
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
                  <button onClick={() => onToggle(originalIndex)} className="flex-1 min-w-0 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-white capitalize">{review.sport}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${review.mode === "game" ? "bg-zinc-800 text-zinc-400" : "bg-zinc-800 text-zinc-400"}`}>
                        {review.mode === "game" ? "Game" : "Clip"}
                      </span>
                      {review.mode === "clip" && review.decisions && (
                        <span className="text-[10px] text-zinc-600">{review.decisions.length} players</span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-600 mt-0.5 truncate">{formatDate(review.timestamp)}</p>
                  </button>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
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
