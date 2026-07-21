import { analyzeChunk, SportsCheckError } from "../../lib/analysis/analyzeChunk";

export async function POST(req: Request) {
  try {
    const { sport, frames, mode, chunkIndex, chunkStart, chunkEnd, jersey, teamColor, teamsNote, lenient } = await req.json();

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
