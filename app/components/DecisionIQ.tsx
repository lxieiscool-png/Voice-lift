"use client";

import { useState } from "react";
import type { Profile, Review, PlayerDecision, GameReport, ChunkSummary, PlayerStat } from "../lib/types";
import {
  gradeClass, sportIcon, formatTime, formatDate,
  TEAM_PALETTE, extractTeamName, buildTeamColorMap,
} from "../lib/decisioniq-helpers";

// ─── Parsers ──────────────────────────────────────────────────────────────────

function extractGrade(text: string) {
  return text.match(/(?:Overall\s+)?Decision\s+Grade:\s*([A-F][+-]?)/i)?.[1] ?? "N/A";
}

function parsePlayerBlocks(text: string): PlayerDecision[] {
  return text.split(/===\s*PLAYER\s*===/i).slice(1).map((block) => {
    const clean = block.replace(/===\s*END\s*===/i, "").trim();
    const field = (l: string) => clean.match(new RegExp(`^${l}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";
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
  const extract = (label: string) =>
    text.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n[A-Z#][\\w &]+:|$)`, "i"))?.[1]?.trim() ?? "";
  const extractList = (label: string) =>
    extract(label).split("\n").map(l => l.replace(/^[-•*\d.]\s*/, "").trim()).filter(Boolean);
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

// ─── UI Components ────────────────────────────────────────────────────────────

function GradePill({ grade }: { grade: string }) {
  return (
    <span className={`inline-block rounded-lg px-2.5 py-0.5 text-sm font-black ${gradeClass(grade, "bg")} ${gradeClass(grade, "text")}`}>
      {grade}
    </span>
  );
}

function ProgressBar({ current, total, label }: { current: number; total: number; label: string }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-zinc-400"><span>{label}</span><span>{pct}%</span></div>
      <div className="h-2 w-full rounded-full bg-zinc-800">
        <div className="h-2 rounded-full bg-white transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const DECISION_FIELDS = [
  { key: "whatHappened" as const,     label: "What Happened",      icon: "🎬" },
  { key: "decisionRead" as const,     label: "Coach's Read",       icon: "🧠" },
  { key: "bestAlternative" as const,  label: "Next Time",          icon: "✅" },
  { key: "whyBetter" as const,        label: "Why It Was Better",  icon: "💡" },
  { key: "patternToImprove" as const, label: "Pattern To Improve", icon: "📈" },
  { key: "practiceFocus" as const,    label: "Practice This Week", icon: "🎯" },
];

function PlayerCard({ decision, teamColor, defaultOpen = false }: {
  decision: PlayerDecision;
  teamColor: typeof TEAM_PALETTE[0];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const grade = decision.grade || "N/A";
  const displayTeam = decision.player.match(/\(([^)]+)\)/)?.[1] ?? null;
  return (
    <div className={`rounded-2xl border border-zinc-800 bg-black border-l-4 ${teamColor.border}`}>
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-3 p-4 text-left min-h-[64px]">
        <GradePill grade={grade} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-white">{decision.player || "Unknown Player"}</p>
            {displayTeam && <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${teamColor.bg} text-white`}>{displayTeam}</span>}
          </div>
          <p className="text-xs text-zinc-400 truncate">{[decision.role, decision.action, decision.sport].filter(Boolean).join(" · ")}</p>
        </div>
        <span className="shrink-0 text-zinc-500 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="border-t border-zinc-800 p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {DECISION_FIELDS.map(({ key, label, icon }) => {
              const val = decision[key];
              if (!val) return null;
              return (
                <div key={key} className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">{icon} {label}</p>
                  <p className="text-sm leading-relaxed text-gray-200">{val as string}</p>
                </div>
              );
            })}
            {decision.otherOptions.length > 0 && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3 sm:col-span-2">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">🔀 Other Options</p>
                <ul className="space-y-1">
                  {decision.otherOptions.map((opt, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-200">
                      <span className="text-zinc-500 mt-0.5 shrink-0">—</span>{opt}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerCardList({ decisions }: { decisions: PlayerDecision[] }) {
  const colorMap = buildTeamColorMap(decisions);
  return (
    <div className="space-y-3">
      {decisions.map((d, i) => (
        <PlayerCard key={i} decision={d} teamColor={colorMap.get(extractTeamName(d.player)) ?? TEAM_PALETTE[0]} defaultOpen={i === 0} />
      ))}
    </div>
  );
}

const GAME_SECTIONS = [
  { key: "gameSummary" as const,     label: "Game Summary",          icon: "🏟️" },
  { key: "periodBreakdown" as const, label: "Period Breakdown",       icon: "⏱️" },
  { key: "foulPatterns" as const,    label: "Foul & Call Patterns",   icon: "🚨" },
  { key: "decisionTrends" as const,  label: "Decision Trends",        icon: "📊" },
  { key: "practiceFocus" as const,   label: "Practice This Week",     icon: "🎯" },
];

function GameReportCard({ report }: { report: GameReport }) {
  return (
    <div className="space-y-4">
      <div className={`inline-flex flex-col items-center rounded-2xl px-6 py-3 ${gradeClass(report.overallGrade, "bg")} ${gradeClass(report.overallGrade, "text")}`}>
        <span className="text-xs font-semibold uppercase tracking-widest opacity-80">Overall Grade</span>
        <span className="text-4xl font-black leading-none">{report.overallGrade}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {GAME_SECTIONS.map(({ key, label, icon }) => {
          const val = report[key]; if (!val) return null;
          return (
            <div key={key} className="rounded-2xl border border-zinc-800 bg-black p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">{icon} {label}</p>
              <p className="text-sm leading-relaxed text-gray-200">{val as string}</p>
            </div>
          );
        })}
        {report.strengths.length > 0 && (
          <div className="rounded-2xl border border-emerald-900 bg-black p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-500">✅ Strengths</p>
            <ul className="space-y-1">{report.strengths.map((s, i) => <li key={i} className="flex items-start gap-2 text-sm text-gray-200"><span className="text-emerald-500 shrink-0">+</span>{s}</li>)}</ul>
          </div>
        )}
        {report.improvements.length > 0 && (
          <div className="rounded-2xl border border-orange-900 bg-black p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-orange-500">📉 Work On</p>
            <ul className="space-y-1">{report.improvements.map((s, i) => <li key={i} className="flex items-start gap-2 text-sm text-gray-200"><span className="text-orange-500 shrink-0">→</span>{s}</li>)}</ul>
          </div>
        )}
      </div>
      {report.playerStats.length > 0 && (
        <div className="rounded-2xl border border-zinc-700 bg-black p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">👤 Player Stats</p>
          <div className="space-y-2">
            {report.playerStats.map((p, i) => (
              <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                <p className="text-xs font-bold text-white mb-0.5">{p.label}</p>
                <p className="text-xs text-zinc-400 leading-relaxed">{p.raw.replace(/^#\d+[^|]*\|\s*/, "")}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DecisionIQ Main ──────────────────────────────────────────────────────────

export default function DecisionIQ({
  profile,
  reviews,
  onReviewsChange,
}: {
  profile: Profile;
  reviews: Review[];
  onReviewsChange: (r: Review[]) => void;
}) {
  const [fileName, setFileName] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [sport, setSport] = useState("");

  const [loading, setLoading] = useState(false);
  const [progressLabel, setProgressLabel] = useState("");
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);

  const [decisions, setDecisions] = useState<PlayerDecision[]>([]);
  const [gameReport, setGameReport] = useState<GameReport | null>(null);
  const [resultMode, setResultMode] = useState<"clip" | "game" | null>(null);

  const [expandedReview, setExpandedReview] = useState<number | null>(null);

  function saveReviews(newReviews: Review[]) {
    onReviewsChange(newReviews);
    localStorage.setItem("decisioniq-reviews", JSON.stringify(newReviews));
  }

  function deleteReview(id: string) {
    saveReviews(reviews.filter(r => r.id !== id));
    setExpandedReview(null);
  }

  async function analyzeVideo() {
    if (!videoFile) return;
    setLoading(true); setDecisions([]); setGameReport(null); setResultMode(null);
    setProgressCurrent(0); setProgressTotal(0);

    try {
      setProgressLabel("Extracting frames…");
      const { frames, mode } = await extractFramesAdaptive(videoFile);

      if (mode === "clip") {
        setProgressLabel("Analyzing all players…"); setProgressTotal(1);
        const res = await fetch("/api/analyze", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sport: sport || profile.sport, frames: frames.map(f => f.dataUrl), mode: "clip" }),
        });
        const data = await res.json();
        setProgressCurrent(1);
        const parsed = parsePlayerBlocks(data.feedback ?? "");
        const detectedSport = sport || parsed.find(p => p.sport)?.sport || profile.sport || "Unknown";
        setDecisions(parsed); setResultMode("clip");
        saveReviews([{
          id: crypto.randomUUID(), fileName: fileName || "Untitled clip",
          sport: detectedSport, mode: "clip",
          grade: parsed[0]?.grade ?? "N/A", timestamp: Date.now(), decisions: parsed,
        }, ...reviews]);

      } else {
        const CHUNK_SIZE = 6;
        const chunks: FrameWithTime[][] = [];
        for (let i = 0; i < frames.length; i += CHUNK_SIZE) chunks.push(frames.slice(i, i + CHUNK_SIZE));
        setProgressTotal(chunks.length + 1);
        const chunkSummaries: ChunkSummary[] = [];

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const start = formatTime(chunk[0].timestamp), end = formatTime(chunk[chunk.length - 1].timestamp);
          setProgressLabel(`Analyzing segment ${i + 1} of ${chunks.length} (${start}–${end})…`);
          const res = await fetch("/api/analyze", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sport: sport || profile.sport, frames: chunk.map(f => f.dataUrl), mode: "game", chunkIndex: i, chunkStart: start, chunkEnd: end }),
          });
          const data = await res.json();
          chunkSummaries.push({ index: i, start, end, text: data.feedback ?? "" });
          setProgressCurrent(i + 1);
        }

        setProgressLabel("Generating full game report…");
        const synthRes = await fetch("/api/synthesize", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sport: sport || profile.sport, chunkSummaries }),
        });
        const synthData = await synthRes.json();
        setProgressCurrent(chunks.length + 1);
        const report = parseGameReport(synthData.report ?? "");
        const detectedGameSport = sport || profile.sport ||
          chunkSummaries.map(c => c.text.match(/Sport:\s*(.+)/i)?.[1]?.trim()).find(Boolean) || "Unknown";
        setGameReport(report); setResultMode("game");
        saveReviews([{
          id: crypto.randomUUID(), fileName: fileName || "Untitled game",
          sport: detectedGameSport, mode: "game",
          grade: report.overallGrade, timestamp: Date.now(), gameReport: report,
        }, ...reviews]);
      }
    } catch (err) { console.error(err); }
    setLoading(false); setProgressLabel("");
  }

  const overallGrade = resultMode === "game" ? gameReport?.overallGrade ?? "N/A" : decisions[0]?.grade ?? "N/A";

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upload */}
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5 sm:p-6">
          <h2 className="mb-4 text-xl font-bold sm:text-2xl">Upload</h2>
          <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-zinc-700 p-6 text-center hover:border-white transition-colors">
            <input type="file" accept="video/*" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0]; if (!file) return;
              setVideoFile(file); setFileName(file.name);
              setVideoUrl(URL.createObjectURL(file));
              setDecisions([]); setGameReport(null); setResultMode(null);
            }} />
            <div className="text-4xl mb-2">📹</div>
            <p className="font-semibold">Choose video</p>
            <p className="mt-1 text-sm text-gray-400">Clip or full game — adapts automatically</p>
          </label>
          {videoUrl && <video className="mt-4 w-full rounded-2xl border border-zinc-800" src={videoUrl} controls />}
          {fileName && <p className="mt-3 text-sm text-green-400 truncate">📎 {fileName}</p>}
          <div className="mt-5 space-y-3">
            <input
              className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-sm placeholder-zinc-500 focus:outline-none focus:border-white transition-colors"
              placeholder={profile.sport ? `Sport (${profile.sport})` : "Sport (optional — will detect from video)"}
              value={sport}
              onChange={(e) => setSport(e.target.value)}
            />
            <button
              onClick={analyzeVideo} disabled={loading || !videoFile}
              className="w-full rounded-2xl bg-white py-4 text-base font-bold text-black disabled:opacity-40 hover:bg-gray-100 transition-colors active:scale-95"
            >
              {loading ? "Analyzing…" : "Analyze"}
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold sm:text-2xl">{resultMode === "game" ? "Game Report" : "Player Decisions"}</h2>
            {resultMode && !loading && (
              <div className={`flex flex-col items-center rounded-xl px-4 py-2 ${gradeClass(overallGrade, "bg")} ${gradeClass(overallGrade, "text")}`}>
                <span className="text-xs font-semibold opacity-80">{resultMode === "game" ? "Overall" : "Top"}</span>
                <span className="text-2xl font-black leading-none">{overallGrade}</span>
              </div>
            )}
          </div>
          {loading && (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl border border-zinc-800 bg-black" />)}
              <ProgressBar current={progressCurrent} total={progressTotal} label={progressLabel} />
            </div>
          )}
          {!loading && !resultMode && (
            <div className="flex h-56 flex-col items-center justify-center gap-3 rounded-2xl border border-zinc-800 bg-black">
              <span className="text-5xl">🎬</span>
              <p className="text-center text-sm text-zinc-500 px-4">
                {profile.name ? `Ready when you are, ${profile.name.split(" ")[0]}.` : "Upload a clip or full game and click Analyze"}
              </p>
            </div>
          )}
          {!loading && resultMode === "clip" && decisions.length > 0 && <PlayerCardList decisions={decisions} />}
          {!loading && resultMode === "game" && gameReport && <GameReportCard report={gameReport} />}
        </div>
      </div>

      {/* History */}
      {reviews.length > 0 && (
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold sm:text-2xl">History</h2>
            <span className="text-sm text-zinc-500">{reviews.length} review{reviews.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="space-y-3">
            {reviews.map((review, index) => {
              const isOpen = expandedReview === index;
              return (
                <div key={review.id} className="rounded-2xl border border-zinc-800 bg-black">
                  <div className="flex w-full items-center gap-3 p-4">
                    <span className="text-2xl shrink-0">{sportIcon(review.sport)}</span>
                    <button onClick={() => setExpandedReview(isOpen ? null : index)} className="flex-1 min-w-0 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold capitalize">{review.sport}</p>
                        <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">{review.mode === "game" ? "Full Game" : "Clip"}</span>
                        {review.mode === "clip" && review.decisions && (
                          <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">{review.decisions.length} player{review.decisions.length !== 1 ? "s" : ""}</span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 truncate">{review.fileName}</p>
                      <p className="text-xs text-zinc-600">{formatDate(review.timestamp)}</p>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      <GradePill grade={review.grade} />
                      <button onClick={() => setExpandedReview(isOpen ? null : index)} className="px-1 text-xs text-zinc-500">{isOpen ? "▲" : "▼"}</button>
                      <button onClick={() => deleteReview(review.id)} className="rounded-lg px-2 py-1 text-xs text-zinc-600 hover:text-red-400 hover:bg-zinc-900 transition-colors">✕</button>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="border-t border-zinc-800 p-4">
                      {review.mode === "clip" && review.decisions ? <PlayerCardList decisions={review.decisions} />
                        : review.mode === "game" && review.gameReport ? <GameReportCard report={review.gameReport} />
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
