import { analyzeChunk } from "../../lib/analysis/analyzeChunk";
import { createAdminClient } from "../../lib/supabase/admin";
import { inngest } from "../../lib/inngest/client";
import { friendlyGeminiError } from "../../lib/ai/gemini";
import { checkAndIncrementUsage, refundUsage } from "../../lib/usage";
import { getSessionUserId } from "../../lib/supabase/server";
import { checkAndIncrementGuestUsage } from "../../lib/guestUsage";
import { isRateLimited } from "../../lib/ratelimit";

// POST /api/youtube-analyze { url, sport, jersey, teamColor, teamsNote, lenient }
//
// Analyze a public YouTube video by URL. Gemini ingests YouTube natively, so
// unlike the old storyboard-scraping path this reads the real video at full
// quality — no download, no proxy, nothing for YouTube to block.
//
// Long videos still produce ONE event log rather than many per-segment logs,
// so the code-side tally and synthesis run over a single chunk. That keeps the
// arithmetic in our code (where it is reliable) instead of the model's head.

function extractVideoId(raw: string): string | null {
  const s = raw.trim();
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    if (/(^|\.)youtube\.com$|(^|\.)youtube-nocookie\.com$/.test(u.hostname)) {
      const v = u.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[1];
    }
    if (/(^|\.)youtu\.be$/.test(u.hostname)) {
      const m = u.pathname.match(/^\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch { /* fall through */ }
  const m = s.match(/[?&]v=([a-zA-Z0-9_-]{11})|youtu\.be\/([a-zA-Z0-9_-]{11})/);
  return m ? (m[1] || m[2]) : null;
}

// Duration decides clip vs game. YouTube still answers metadata requests from
// datacenter IPs even when it refuses to share video, so this stays reliable.
// If it fails we assume a clip: a wrong guess there costs one deep pass, while
// wrongly guessing "game" burns a scarcer game credit.
async function fetchDurationSeconds(videoId: string): Promise<number | null> {
  const clients = [
    { clientName: "ANDROID", clientVersion: "19.09.37", androidSdkVersion: 34, hl: "en" },
    { clientName: "WEB", clientVersion: "2.20240401.00.00", hl: "en" },
  ];
  for (const client of clients) {
    try {
      const res = await fetch("https://www.youtube.com/youtubei/v1/player", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: { client }, videoId, contentCheckOk: true, racyCheckOk: true }),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const len = parseInt(json?.videoDetails?.lengthSeconds ?? "");
      if (Number.isFinite(len) && len > 0) return len;
    } catch { /* next client */ }
  }
  return null;
}

export async function POST(req: Request) {
  if (isRateLimited(req, "yt-analyze", 20)) {
    return Response.json({ error: "Too many requests — try again in a minute." }, { status: 429 });
  }

  let metered: { userId: string; kind: "clip" | "game" } | null = null;
  try {
    const body = await req.json().catch(() => null);
    if (!body) return Response.json({ error: "Invalid request body." }, { status: 400 });

    const url = typeof body.url === "string" ? body.url.trim() : "";
    const videoId = extractVideoId(url);
    if (!videoId) return Response.json({ error: "That doesn't look like a YouTube link." }, { status: 400 });

    const sport     = typeof body.sport === "string" ? body.sport.slice(0, 40) : undefined;
    const jersey    = typeof body.jersey === "string" ? body.jersey.slice(0, 10) : undefined;
    const teamColor = typeof body.teamColor === "string" ? body.teamColor.slice(0, 30) : undefined;
    const teamsNote = typeof body.teamsNote === "string" ? body.teamsNote.slice(0, 500) : undefined;
    const lenient   = !!body.lenient;

    const durationSeconds = await fetchDurationSeconds(videoId);
    const mode: "clip" | "game" = (durationSeconds ?? 0) > 120 ? "game" : "clip";

    // Same metering as every other analysis path.
    const userId = await getSessionUserId();
    if (userId) {
      const usage = await checkAndIncrementUsage(userId, mode);
      if (!usage.ok) {
        return Response.json(
          { error: "limit_reached", limit: usage.limit, count: usage.count, isPro: usage.isPro },
          { status: 403 },
        );
      }
      metered = { userId, kind: mode };
    } else if (!(await checkAndIncrementGuestUsage(req, mode))) {
      return Response.json(
        { error: "guest_limit_reached", message: "You've used this month's free guest analyses. Create a free account to keep going." },
        { status: 403 },
      );
    }

    // Canonical watch URL — Gemini resolves this form reliably.
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Clips are one call and finish well inside the request timeout.
    if (mode === "clip") {
      const text = await analyzeChunk({
        sport, frames: [], mode, jersey, teamColor, teamsNote, lenient, videoUrl,
      });
      return Response.json({ mode, feedback: text, durationSeconds });
    }

    // Games are split into time windows and take minutes — far past the
    // serverless request limit — so they run as a background job. The client
    // already polls analysis_jobs, so it picks this up with no extra wiring.
    if (!userId) {
      if (metered) await refundUsage(metered.userId, metered.kind);
      return Response.json(
        { error: "Sign in to analyze a full game — it runs in the background so you can close the tab." },
        { status: 401 },
      );
    }

    const supabase = createAdminClient();
    const { data: job, error: jobError } = await supabase.from("analysis_jobs").insert({
      user_id: userId, status: "queued",
      file_name: `YouTube: ${url}`, sport: sport ?? null,
      team_id: body.teamId ?? null, opponent_name: body.opponentName ?? null,
      game_type: body.gameType ?? null, game_date: body.gameDate ?? null,
      progress_total: Math.min(20, Math.max(1, Math.ceil((durationSeconds ?? 240) / 240))),
    }).select("id").single();
    if (jobError) throw new Error(jobError.message);

    await inngest.send({
      name: "game/analysis.requested",
      data: {
        jobId: job.id, userId, videoUrl, durationSeconds: durationSeconds ?? 0,
        frameCount: 0, timestamps: [], jersey, teamColor, teamsNote, lenient,
      },
    });

    return Response.json({ mode, queued: true, jobId: job.id, durationSeconds });
  } catch (error: unknown) {
    if (metered) await refundUsage(metered.userId, metered.kind);
    console.error("YOUTUBE ANALYZE ERROR:", error);
    return Response.json({ error: friendlyGeminiError(error) }, { status: 500 });
  }
}
