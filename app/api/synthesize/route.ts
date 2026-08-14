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
    // Cap the spend: a real game tops out around 67 segments (400 frames / 6),
    // each a ~1-2k char summary. Anything past these bounds is not our client —
    // reject or truncate instead of forwarding an arbitrarily large prompt.
    if (chunkSummaries.length > 80) {
      return Response.json({ error: "Too many segments." }, { status: 400 });
    }
    const clean = chunkSummaries.map((c: any, i: number) => ({
      index: typeof c?.index === "number" ? c.index : i,
      start: String(c?.start ?? "").slice(0, 20),
      end: String(c?.end ?? "").slice(0, 20),
      text: String(c?.text ?? "").slice(0, 8000),
    }));

    const report = await synthesizeGameReport({
      sport: typeof sport === "string" ? sport.slice(0, 60) : undefined,
      chunkSummaries: clean,
      teamsNote: typeof teamsNote === "string" ? teamsNote.slice(0, 500) : undefined,
      jersey: typeof jersey === "string" ? jersey.slice(0, 10) : undefined,
      teamColor: typeof teamColor === "string" ? teamColor.slice(0, 30) : undefined,
    });

    return Response.json({ report });
  } catch (error: any) {
    console.error("SYNTHESIZE ERROR:", error);
    return Response.json({ error: error?.message || "Synthesis failed." }, { status: 500 });
  }
}
