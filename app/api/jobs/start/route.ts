import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../lib/supabase/admin";
import { checkAndIncrementUsage } from "../../../lib/usage";

// Creates a job row the client can then upload frames against. Frames are
// uploaded one at a time in separate requests (see [jobId]/frame) rather
// than all at once here — a full game's worth of frames as base64 in a
// single request body would blow past Vercel's ~4.5MB request size limit.
export async function POST(req: NextRequest) {
  const { userId, fileName, sport, teamId, opponentName, gameType, gameDate, location, thumbnailUrl } = await req.json();
  if (!userId) return NextResponse.json({ error: "Missing userId." }, { status: 400 });

  // Authoritative spend gate for the expensive game path — the client's
  // pre-check is only a courtesy; this is what actually protects cost.
  const usage = await checkAndIncrementUsage(userId, "game");
  if (!usage.ok) {
    return NextResponse.json(
      { error: "limit_reached", limit: usage.limit, count: usage.count, isPro: usage.isPro },
      { status: 403 },
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.from("analysis_jobs").insert({
    user_id: userId, status: "queued", file_name: fileName ?? null, sport: sport ?? null,
    team_id: teamId ?? null, opponent_name: opponentName ?? null, game_type: gameType ?? null,
    game_date: gameDate ?? null, location: location ?? null, thumbnail_url: thumbnailUrl ?? null,
  }).select("id").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ jobId: data.id });
}
