import { randomUUID } from "crypto";
import { NonRetriableError } from "inngest";
import { inngest } from "./client";
import { createAdminClient } from "../supabase/admin";
import { analyzeChunk, SportsCheckError } from "../analysis/analyzeChunk";
import { synthesizeGameReport } from "../analysis/synthesize";
import { parseGameReport } from "../analysis/parsers";
import { formatTime } from "../decisioniq-helpers";

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
    },
  },
  async ({ event, step }) => {
    const { jobId, userId, frameCount, timestamps, jersey, teamColor, teamsNote, lenient } = event.data as {
      jobId: string; userId: string; frameCount: number; timestamps: number[];
      jersey?: string; teamColor?: string; teamsNote?: string; lenient?: boolean;
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
            jersey, teamColor, teamsNote, lenient,
          });
          await supabase.from("analysis_jobs")
            .update({ progress_current: end, progress_label: `Segment ${i + 1} of ${chunkRanges.length}` })
            .eq("id", jobId);
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

    const chunkSummaries: { index: number; start: string; end: string; text: string }[] = [];
    for (let batchStart = 0; batchStart < chunkRanges.length; batchStart += CONCURRENCY) {
      const batch = chunkRanges.slice(batchStart, batchStart + CONCURRENCY).map((_, k) => runSegment(batchStart + k));
      chunkSummaries.push(...(await Promise.all(batch)));
    }

    const reportText = await step.run("synthesize", async () => {
      await supabase.from("analysis_jobs").update({ progress_label: "Building game report…" }).eq("id", jobId);
      return synthesizeGameReport({ sport: job.sport, chunkSummaries, teamsNote, jersey, teamColor });
    });

    const reviewId = await step.run("save-review", async () => {
      const report = parseGameReport(reportText);
      const myGrade = reportText.match(/Your Grade:\s*([A-F][+-]?)/i)?.[1];
      const id = randomUUID();
      const { error } = await supabase.from("reviews").insert({
        id, user_id: userId, file_name: job.file_name, sport: job.sport, mode: "game",
        grade: myGrade ?? report.overallGrade, created_at: new Date().toISOString(),
        data: { gameReport: report },
        team_id: job.team_id, opponent_name: job.opponent_name, game_type: job.game_type,
        game_date: job.game_date, location: job.location,
      });
      if (error) throw new Error(`Failed to save review: ${error.message}`);
      return id;
    });

    await step.run("mark-complete", async () => {
      await supabase.from("analysis_jobs")
        .update({ status: "complete", review_id: reviewId, progress_current: frameCount })
        .eq("id", jobId);
    });

    await step.run("cleanup-frames", async () => {
      const paths = Array.from({ length: frameCount }, (_, i) => `${jobId}/${String(i).padStart(5, "0")}.jpg`);
      await supabase.storage.from("game-frames").remove(paths);
    });

    return { reviewId };
  }
);
