import { synthesizeGameReport } from "../../lib/analysis/synthesize";
import { isRateLimited } from "../../lib/ratelimit";

export async function POST(req: Request) {
  if (isRateLimited(req, "synthesize", 30)) {
    return Response.json({ error: "Too many requests — try again in a minute." }, { status: 429 });
  }
  try {
    const body = await req.json().catch(() => null);
    if (!body) return Response.json({ error: "Invalid request body." }, { status: 400 });
    const { sport, chunkSummaries, teamsNote, jersey, teamColor } = body;

    // Validate before spending: synthesis needs real segment summaries.
    if (!Array.isArray(chunkSummaries) || chunkSummaries.length === 0) {
      return Response.json({ error: "No segment summaries to synthesize." }, { status: 400 });
    }

    const report = await synthesizeGameReport({ sport, chunkSummaries, teamsNote, jersey, teamColor });

    return Response.json({ report });
  } catch (error: any) {
    console.error("SYNTHESIZE ERROR:", error);
    return Response.json({ error: error?.message || "Synthesis failed." }, { status: 500 });
  }
}
