import { analyzeDrill, DrillCheckError } from "../../lib/analysis/analyzeDrill";
import { checkAndIncrementUsage, refundUsage } from "../../lib/usage";
import { isRateLimited } from "../../lib/ratelimit";
import { getSessionUserId } from "../../lib/supabase/server";

// POST /api/drill { drill, frames, sport }
// Checks a player's recording of a prescribed solo drill. Metered as a clip
// (cheap, ~24 frames) for signed-in users; guests are exempt. Identity comes
// from the session cookie, same as every other metered route.
export async function POST(req: Request) {
  if (isRateLimited(req, "drill", 20)) {
    return Response.json({ error: "Too many requests — slow down and try again in a minute." }, { status: 429 });
  }
  let metered: string | null = null;
  try {
    const { drill, frames, sport } = await req.json();
    if (!drill || !frames?.length) {
      return Response.json({ error: "Missing drill or frames." }, { status: 400 });
    }
    if (!Array.isArray(frames) || frames.length > 32 || typeof drill !== "string" || drill.length > 1000
      || frames.some((f: unknown) => typeof f !== "string" || !f.startsWith("data:image/"))) {
      return Response.json({ error: "Invalid drill or frames." }, { status: 400 });
    }

    const userId = await getSessionUserId();
    if (userId) {
      const usage = await checkAndIncrementUsage(userId, "clip");
      if (!usage.ok) {
        return Response.json(
          { error: "limit_reached", limit: usage.limit, count: usage.count, isPro: usage.isPro },
          { status: 403 },
        );
      }
      metered = userId;
    }

    const feedback = await analyzeDrill({ drill, frames, sport });
    return Response.json({ feedback });
  } catch (error: any) {
    // Don't charge for feedback the user never got.
    if (metered) await refundUsage(metered, "clip");
    if (error instanceof DrillCheckError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("DRILL ANALYSIS ERROR:", error);
    return Response.json({ error: error?.message || "Drill check failed." }, { status: 500 });
  }
}
