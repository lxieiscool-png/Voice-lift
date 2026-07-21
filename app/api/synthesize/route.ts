import { synthesizeGameReport } from "../../lib/analysis/synthesize";

export async function POST(req: Request) {
  try {
    const { sport, chunkSummaries, teamsNote, jersey, teamColor } = await req.json();

    const report = await synthesizeGameReport({ sport, chunkSummaries, teamsNote, jersey, teamColor });

    return Response.json({ report });
  } catch (error: any) {
    console.error("SYNTHESIZE ERROR:", error);
    return Response.json({ error: error?.message || "Synthesis failed." }, { status: 500 });
  }
}
