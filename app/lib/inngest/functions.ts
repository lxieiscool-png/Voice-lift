import { randomUUID } from "crypto";
import { NonRetriableError } from "inngest";
import { inngest } from "./client";
import { createAdminClient } from "../supabase/admin";
import { analyzeChunk, SportsCheckError } from "../analysis/analyzeChunk";
import { synthesizeGameReport } from "../analysis/synthesize";
import { parseGameReport, buildBoxScore, buildVolleyBoxScore, buildDecisionTimeline } from "../analysis/parsers";
import { formatTime } from "../decisioniq-helpers";
import { refundUsage } from "../usage";
import { geminiGenerate } from "../ai/gemini";

// Scaffolding check — confirms the Inngest dev server can reach this app and
// run a step-based function before any real analysis logic is built on top.
export const ping = inngest.createFunction(
  { id: "ping", triggers: [{ event: "test/ping" }] },
  async ({ event, step }) => {
    const result = await step.run("echo", async () => {
      return { receivedAt: Date.now(), message: event.data?.message ?? "no message" };
    });
    return result;
  }
);

const CHUNK_SIZE = 6;
const CONCURRENCY = 5;

async function downloadFrame(supabase: ReturnType<typeof createAdminClient>, jobId: string, index: number) {
  const path = `${jobId}/${String(index).padStart(5, "0")}.jpg`;
  const { data, error } = await supabase.storage.from("game-frames").download(path);
  if (error) throw new Error(`Failed to download frame ${index}: ${error.message}`);
  const buf = Buffer.from(await data.arrayBuffer());
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

export const analyzeGameJob = inngest.createFunction(
  {
    id: "analyze-game-job",
    triggers: [{ event: "game/analysis.requested" }],
    // 45-minute ceiling: deep enough to go far past the old synchronous
    // limits, capped well under the ~1-2 hours HoopIQ reportedly takes.
    timeouts: { finish: "45m" },
    onFailure: async ({ event, step }) => {
      const jobId = (event.data as any)?.event?.data?.jobId;
      const frameCount = (event.data as any)?.event?.data?.frameCount as number | undefined;
      if (!jobId) return;
      const supabase = createAdminClient();
      await step.run("mark-failed", async () => {
        // A step may have already recorded a specific reason (e.g. the
        // sports-footage precheck rejecting the video) before throwing —
        // don't stomp that with this generic fallback.
        const { data: current } = await supabase.from("analysis_jobs").select("status").eq("id", jobId).single();
        if (current?.status === "failed") return;
        await supabase.from("analysis_jobs")
          .update({ status: "failed", error: "Analysis failed after retries. Please try again." })
          .eq("id", jobId);
      });
      // The happy-path cleanup step never runs on failure — without this,
      // every failed job leaves its uploaded frames orphaned in storage.
      await step.run("cleanup-frames-on-failure", async () => {
        if (!frameCount) return;
        const paths = Array.from({ length: frameCount }, (_, i) => `${jobId}/${String(i).padStart(5, "0")}.jpg`);
        await supabase.storage.from("game-frames").remove(paths);
      });
      // A failed game shouldn't burn one of the user's few monthly game
      // credits — refund what /api/jobs/start charged.
      await step.run("refund-game-credit", async () => {
        const failedUserId = (event.data as any)?.event?.data?.userId;
        if (failedUserId) await refundUsage(failedUserId, "game");
      });
    },
  },
  async ({ event, step }) => {
    const { jobId, userId, frameCount, timestamps, jersey, teamColor, teamsNote, lenient, videoUrl, durationSeconds } = event.data as {
      jobId: string; userId: string; frameCount: number; timestamps: number[];
      jersey?: string; teamColor?: string; teamsNote?: string; lenient?: boolean;
      // YouTube path: no frames are uploaded at all. The video is analyzed in
      // place, one time window per step.
      videoUrl?: string; durationSeconds?: number;
    };
    const supabase = createAdminClient();

    const job = await step.run("load-job", async () => {
      const { data, error } = await supabase.from("analysis_jobs").select("*").eq("id", jobId).single();
      if (error) throw new Error(`Job ${jobId} not found: ${error.message}`);
      return data;
    });

    await step.run("mark-processing", async () => {
      await supabase.from("analysis_jobs").update({ status: "processing" }).eq("id", jobId);
    });

    // If this game is linked to a team, the roster's jersey numbers become a
    // hard constraint — the model can't report a #6 when only #8 exists,
    // which is where most two-digit misreads come from.
    const rosterNumbers = await step.run("load-roster", async () => {
      if (!job.team_id) return [] as string[];
      const { data } = await supabase.from("team_members")
        .select("jersey_number").eq("team_id", job.team_id);
      return (data ?? [])
        .map((r: { jersey_number: string | null }) => (r.jersey_number ?? "").trim())
        .filter(Boolean);
    });

    // A whole game analyzed in ONE call makes the model summarize a few
    // highlights instead of logging every possession, so the video is split
    // into windows — the same shape as the frame-chunk path below.
    const WINDOW_SECONDS = 240;
    const MAX_WINDOWS = 20;

    // YouTube often refuses to tell Vercel's servers how long a video is. The
    // old fallback of 0 became a single 1-second window — a 40-minute game
    // "finished" in 14 seconds with nothing in it. Gemini can see the video,
    // so ask it: a very sparse, low-res look costs ~2¢ and was exact in tests.
    const videoLength = !videoUrl ? 0 : durationSeconds && durationSeconds > 0 ? durationSeconds
      : await step.run("resolve-duration", async () => {
          const text = await geminiGenerate({
            prompt: "How long is this video in total? Reply with only the total length in seconds as a whole number, nothing else.",
            videoUrl, videoFps: 0.02, videoResolution: "low", thinking: "low", temperature: 0,
          });
          const secs = parseInt(text.match(/\d+/)?.[0] ?? "", 10);
          if (!Number.isFinite(secs) || secs <= 0) {
            const reason = "We couldn't read this video's length. Try the link again, or use screen capture.";
            await supabase.from("analysis_jobs").update({ status: "failed", error: reason }).eq("id", jobId);
            throw new NonRetriableError(reason);
          }
          await supabase.from("analysis_jobs")
            .update({ progress_total: Math.min(MAX_WINDOWS, Math.ceil(secs / WINDOW_SECONDS)) })
            .eq("id", jobId);
          return secs;
        });

    const videoWindows: { start: number; end: number }[] = [];
    if (videoUrl) {
      const total = Math.max(1, videoLength);
      const count = Math.min(MAX_WINDOWS, Math.max(1, Math.ceil(total / WINDOW_SECONDS)));
      const span = total / count;
      for (let i = 0; i < count; i++) {
        videoWindows.push({ start: Math.floor(i * span), end: Math.ceil(Math.min(total, (i + 1) * span)) });
      }
    }

    const chunkRanges: { start: number; end: number }[] = [];
    for (let i = 0; i < frameCount; i += CHUNK_SIZE) chunkRanges.push({ start: i, end: Math.min(i + CHUNK_SIZE, frameCount) });

    async function runSegment(i: number) {
      const { start, end } = chunkRanges[i];
      return step.run(`segment-${i}`, async () => {
        const frames = await Promise.all(
          Array.from({ length: end - start }, (_, k) => downloadFrame(supabase, jobId, start + k))
        );
        const chunkStart = formatTime(timestamps[start]);
        const chunkEnd = formatTime(timestamps[end - 1]);
        try {
          const text = await analyzeChunk({
            sport: job.sport, frames, mode: "game", chunkIndex: i, chunkStart, chunkEnd,
            jersey, teamColor, teamsNote, lenient, rosterNumbers,
          });
          return { index: i, start: chunkStart, end: chunkEnd, text };
        } catch (e) {
          if (e instanceof SportsCheckError) {
            // Not a transient failure — retrying won't help. Fail the job now
            // with the real reason instead of burning retries on every segment.
            await supabase.from("analysis_jobs").update({ status: "failed", error: e.message }).eq("id", jobId);
            throw new NonRetriableError(e.message);
          }
          throw e;
        }
      });
    }

    // One window of the video per step: Gemini reads only that slice, so each
    // call can log its possessions exhaustively instead of skimming the game.
    async function runVideoWindow(i: number) {
      const { start, end } = videoWindows[i];
      return step.run(`video-window-${i}`, async () => {
        const text = await analyzeChunk({
          sport: job.sport, frames: [], mode: "game", chunkIndex: i,
          chunkStart: formatTime(start), chunkEnd: formatTime(end),
          jersey, teamColor, teamsNote, lenient, rosterNumbers,
          videoUrl, videoStart: start, videoEnd: end,
        });
        return { index: i, start: formatTime(start), end: formatTime(end), text };
      });
    }

    const units = videoUrl ? videoWindows : chunkRanges;
    const chunkSummaries: { index: number; start: string; end: string; text: string }[] = [];
    // Progress is written once per batch, not per window: windows run in
    // parallel and finish out of order, so "window 3 done" said nothing about
    // how many were actually finished. The client smooths between batches.
    await step.run("progress-start", async () => {
      await supabase.from("analysis_jobs")
        .update({ progress_current: 0, progress_total: units.length, progress_label: "Watching the game…" })
        .eq("id", jobId);
    });
    for (let batchStart = 0; batchStart < units.length; batchStart += CONCURRENCY) {
      const batch = units.slice(batchStart, batchStart + CONCURRENCY)
        .map((_, k) => (videoUrl ? runVideoWindow(batchStart + k) : runSegment(batchStart + k)));
      chunkSummaries.push(...(await Promise.all(batch)));
      const done = chunkSummaries.length;
      await step.run(`progress-${batchStart}`, async () => {
        await supabase.from("analysis_jobs")
          .update({ progress_current: done, progress_label: "Watching the game…" })
          .eq("id", jobId);
      });
    }

    const reportText = await step.run("synthesize", async () => {
      await supabase.from("analysis_jobs").update({ progress_label: "Building game report…" }).eq("id", jobId);
      return synthesizeGameReport({ sport: job.sport, chunkSummaries, teamsNote, jersey, teamColor });
    });

    const reviewId = await step.run("save-review", async () => {
      const report = parseGameReport(reportText);
      // Each builder returns [] unless the segments' stat events are its
      // sport, so at most one of these is populated.
      const chunkTexts = chunkSummaries.map(c => c.text);
      report.boxScore = buildBoxScore(chunkTexts);
      report.volleyBox = buildVolleyBoxScore(chunkTexts);
      report.timeline = buildDecisionTimeline(chunkTexts);
      // No possessions and no stat events means the analysis didn't really run. Fail it
      // (onFailure refunds the credit) rather than saving a blank "N/A" review.
      if (report.timeline.length === 0 && report.boxScore.length === 0 && report.volleyBox.length === 0) {
        const reason = "We couldn't find any plays in this video. Your game credit was refunded — try again, or use screen capture.";
        await supabase.from("analysis_jobs").update({ status: "failed", error: reason }).eq("id", jobId);
        throw new NonRetriableError(reason);
      }
      const myGrade = reportText.match(/Your Grade:\s*([A-F][+-]?)/i)?.[1];
      const id = randomUUID();
      const { error } = await supabase.from("reviews").insert({
        id, user_id: userId, file_name: job.file_name, sport: job.sport, mode: "game",
        grade: myGrade ?? report.overallGrade, created_at: new Date().toISOString(),
        data: { gameReport: report },
        team_id: job.team_id, opponent_name: job.opponent_name, game_type: job.game_type,
        game_date: job.game_date, location: job.location, thumbnail_url: job.thumbnail_url,
      });
      if (error) throw new Error(`Failed to save review: ${error.message}`);
      return id;
    });

    await step.run("mark-complete", async () => {
      await supabase.from("analysis_jobs")
        .update({ status: "complete", review_id: reviewId, progress_current: units.length })
        .eq("id", jobId);
    });

    if (!videoUrl) {
      await step.run("cleanup-frames", async () => {
        const paths = Array.from({ length: frameCount }, (_, i) => `${jobId}/${String(i).padStart(5, "0")}.jpg`);
        await supabase.storage.from("game-frames").remove(paths);
      });
    }

    return { reviewId };
  }
);
