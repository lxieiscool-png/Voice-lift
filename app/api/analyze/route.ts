import { analyzeChunk, SportsCheckError } from "../../lib/analysis/analyzeChunk";
import { checkAndIncrementUsage, refundUsage } from "../../lib/usage";
import { isRateLimited } from "../../lib/ratelimit";
import { getSessionUserId } from "../../lib/supabase/server";

export async function POST(req: Request) {
  // Blunt anti-abuse: a normal analysis fans out many chunk calls, so this is
  // generous — only a scripted flood trips it.
  if (isRateLimited(req, "analyze", 120)) {
    return Response.json({ error: "Too many requests — slow down and try again in a minute." }, { status: 429 });
  }
  let metered: string | null = null;
  try {
    const body = await req.json().catch(() => null);
    if (!body) return Response.json({ error: "Invalid request body." }, { status: 400 });
    const { sport, frames, mode, chunkIndex, chunkStart, chunkEnd, jersey, teamColor, teamsNote, lenient } = body;
    // Identity comes from the session cookie only — a userId in the body is
    // client-controlled and would let anyone meter (or dodge metering as)
    // any user whose UUID they know.
    const userId = await getSessionUserId();

    // Validate before spending anything: frames must be a non-empty array of
    // image data URLs — otherwise fail fast with 400 instead of erroring deep
    // in the OpenAI call (and never meter a request we're rejecting).
    if (!Array.isArray(frames) || frames.length === 0) {
      return Response.json({ error: "No frames to analyze." }, { status: 400 });
    }

    // Clip analysis is a single call, so this is the right spot to meter it for
    // signed-in users. (Signed-in games run through /api/jobs/start, metered
    // there — and a guest game hits this route once per chunk, so we must not
    // count those here.) Guests have no account to gate on and are exempt.
    if (mode === "clip" && userId) {
      const usage = await checkAndIncrementUsage(userId, "clip");
      if (!usage.ok) {
        return Response.json(
          { error: "limit_reached", limit: usage.limit, count: usage.count, isPro: usage.isPro },
          { status: 403 },
        );
      }
      metered = userId;
    }

    const feedback = await analyzeChunk({ sport, frames, mode, chunkIndex, chunkStart, chunkEnd, jersey, teamColor, teamsNote, lenient });

    return Response.json({ feedback });
  } catch (error: any) {
    // Don't charge for an analysis the user never got.
    if (metered) await refundUsage(metered, "clip");
    if (error instanceof SportsCheckError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("OPENAI ERROR:", error);
    return Response.json({ error: error?.message || "Analysis failed." }, { status: 500 });
  }
}
