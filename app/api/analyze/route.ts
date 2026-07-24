import { analyzeChunk, SportsCheckError } from "../../lib/analysis/analyzeChunk";
import { checkAndIncrementUsage } from "../../lib/usage";

export async function POST(req: Request) {
  try {
    const { sport, frames, mode, chunkIndex, chunkStart, chunkEnd, jersey, teamColor, teamsNote, lenient, userId } = await req.json();

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
    }

    const feedback = await analyzeChunk({ sport, frames, mode, chunkIndex, chunkStart, chunkEnd, jersey, teamColor, teamsNote, lenient });

    return Response.json({ feedback });
  } catch (error: any) {
    if (error instanceof SportsCheckError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("OPENAI ERROR:", error);
    return Response.json({ error: error?.message || "Analysis failed." }, { status: 500 });
  }
}
