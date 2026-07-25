import { analyzeDrill, DrillCheckError } from "../../lib/analysis/analyzeDrill";
import { checkAndIncrementUsage } from "../../lib/usage";

// POST /api/drill { drill, frames, sport, userId }
// Checks a player's recording of a prescribed solo drill. Metered as a clip
// (cheap, ~24 frames) for signed-in users; guests are exempt.
export async function POST(req: Request) {
  try {
    const { drill, frames, sport, userId } = await req.json();
    if (!drill || !frames?.length) {
      return Response.json({ error: "Missing drill or frames." }, { status: 400 });
    }

    if (userId) {
      const usage = await checkAndIncrementUsage(userId, "clip");
      if (!usage.ok) {
        return Response.json(
          { error: "limit_reached", limit: usage.limit, count: usage.count, isPro: usage.isPro },
          { status: 403 },
        );
      }
    }

    const feedback = await analyzeDrill({ drill, frames, sport });
    return Response.json({ feedback });
  } catch (error: any) {
    if (error instanceof DrillCheckError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("DRILL ANALYSIS ERROR:", error);
    return Response.json({ error: error?.message || "Drill check failed." }, { status: 500 });
  }
}
