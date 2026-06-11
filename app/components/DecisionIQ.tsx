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
  const [open, setOpen] = useState(defaultOpen);
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
        <span className="shrink-0 text-[10px] text-zinc-700">{open ? "HIDE" : "MORE"}</span>
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
  const [decisions,   setDecisions]   = useState<PlayerDecision[]>([]);
  const [gameReport,  setGameReport]  = useState<GameReport | null>(null);
  const [resultMode,  setResultMode]  = useState<"clip" | "game" | null>(null);
  const [expandedReview, setExpandedReview] = useState<number | null>(null);

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
      const data = await res.json(); setProgressCurrent(1);
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
        const data = await res.json();
        chunkSummaries.push({ index: i, start, end, text: data.feedback ?? "" }); setProgressCurrent(i + 1);
      }
      setProgressLabel("Building game report…");
      const synthRes  = await fetch("/api/synthesize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sport: sport || profile.sport, chunkSummaries }) });
      const synthData = await synthRes.json(); setProgressCurrent(chunks.length + 1);
      const report = parseGameReport(synthData.report ?? "");
      const detectedGameSport = sport || profile.sport || "Unknown";
      setGameReport(report); setResultMode("game");
      saveReviews([{ id: crypto.randomUUID(), fileName: videoTitle, sport: detectedGameSport, mode: "game", grade: report.overallGrade, timestamp: Date.now(), gameReport: report }, ...reviews]);
    }
  }

  async function analyzeVideo() {
    if (!videoFile) return;
    setLoading(true); setDecisions([]); setGameReport(null); setResultMode(null);
    setProgressCurrent(0); setProgressTotal(0);
    try {
      setProgressLabel("Extracting frames…");
      const { frames, mode } = await extractFramesAdaptive(videoFile);

      await runAnalysis(frames, mode, fileName || "Untitled");
    } catch (err) { console.error(err); }
    setLoading(false); setProgressLabel("");
  }

  const overallGrade = resultMode === "game" ? gameReport?.overallGrade ?? "N/A" : decisions[0]?.grade ?? "N/A";

  return (
    <div className="space-y-5">

      {/* Upload + Results */}
      <div className="grid gap-5 lg:grid-cols-2">

        {/* Upload */}
        <div className="border border-zinc-800 bg-zinc-950 rounded-xl p-5">
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
              <label className="block cursor-pointer rounded-lg border border-dashed border-zinc-800 p-6 text-center hover:border-zinc-600 transition-colors">
                <input type="file" accept="video/*" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0]; if (!file) return;
                  setVideoFile(file); setFileName(file.name);
                  setVideoUrl(URL.createObjectURL(file));
                  setDecisions([]); setGameReport(null); setResultMode(null);
                }} />
                <p className="text-sm font-medium text-zinc-400">Choose video</p>
                <p className="mt-1 text-xs text-zinc-600">Clip or full game — adapts automatically</p>
              </label>
              {videoUrl && <video className="mt-4 w-full rounded-lg border border-zinc-800" src={videoUrl} controls />}
              {fileName && <p className="mt-2 text-xs text-zinc-500 truncate">{fileName}</p>}
            </>
          ) : (
            <div className="rounded-lg border border-zinc-800 p-4 space-y-3">
              <p className="text-sm font-medium text-white">How to analyze a YouTube video</p>
              <div className="space-y-2">
                {[
                  { num: "1", text: "Go to cobalt.tools" },
                  { num: "2", text: "Paste your YouTube link and download the video as MP4" },
                  { num: "3", text: 'Switch to "Video File" tab above and upload it' },
                ].map(s => (
                  <div key={s.num} className="flex items-start gap-3">
                    <span className="shrink-0 mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold text-zinc-400">{s.num}</span>
                    <p className="text-sm text-zinc-400">{s.text}</p>
                  </div>
                ))}
              </div>
              <a
                href="https://cobalt.tools"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-lg border border-zinc-700 py-2.5 text-center text-sm font-semibold text-white hover:bg-zinc-800 transition-colors"
              >
                Open cobalt.tools
              </a>
              <p className="text-xs text-zinc-600">Free, no account needed. Works with YouTube, Instagram, TikTok, and more.</p>
            </div>
          )}

          {inputTab === "file" && (
            <div className="mt-4 space-y-2">
              <input
                className="w-full rounded-lg border border-zinc-800 bg-black px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
                placeholder={profile.sport ? `Sport (${profile.sport})` : "Sport — optional, will detect from video"}
                value={sport}
                onChange={e => setSport(e.target.value)}
              />
              <button
                onClick={analyzeVideo}
                disabled={loading || !videoFile}
                className="w-full rounded-lg bg-white py-3 text-sm font-semibold text-black disabled:opacity-30 hover:bg-zinc-100 transition-colors"
              >
                {loading ? "Analyzing…" : "Analyze"}
              </button>
            </div>
          )}
        </div>

        {/* Results */}
        <div className="border border-zinc-800 bg-zinc-950 rounded-xl p-5">
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

          {!loading && !resultMode && (
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

      {/* History */}
      {reviews.length > 0 && (
        <div className="border border-zinc-800 bg-zinc-950 rounded-xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-white">History</p>
            <span className="text-xs text-zinc-600">{reviews.length} review{reviews.length !== 1 ? "s" : ""}</span>
          </div>

          <div className="space-y-2">
            {reviews.map((review, index) => {
              const isOpen = expandedReview === index;
              return (
                <div key={review.id} className="border border-zinc-800 rounded-lg overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button onClick={() => setExpandedReview(isOpen ? null : index)} className="flex-1 min-w-0 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-white capitalize">{review.sport}</span>
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                          {review.mode === "game" ? "Game" : "Clip"}
                        </span>
                        {review.mode === "clip" && review.decisions && (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                            {review.decisions.length}p
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-600 truncate mt-0.5">{formatDate(review.timestamp)}</p>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      <GradeBadge grade={review.grade} />
                      <button onClick={() => setExpandedReview(isOpen ? null : index)}
                        className="text-[10px] text-zinc-700 hover:text-zinc-400 transition-colors px-1">
                        {isOpen ? "HIDE" : "VIEW"}
                      </button>
                      <button onClick={() => deleteReview(review.id)}
                        className="text-[10px] text-zinc-700 hover:text-red-500 transition-colors px-1">
                        DEL
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-zinc-800 p-4">
                      {review.mode === "clip" && review.decisions
                        ? <PlayerCardList decisions={review.decisions} />
                        : review.mode === "game" && review.gameReport
                        ? <GameReportCard report={review.gameReport} />
                        : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
