import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../lib/supabase/admin";

// Creates a job row the client can then upload frames against. Frames are
// uploaded one at a time in separate requests (see [jobId]/frame) rather
// than all at once here — a full game's worth of frames as base64 in a
// single request body would blow past Vercel's ~4.5MB request size limit.
export async function POST(req: NextRequest) {
  const { userId, fileName, sport, teamId, opponentName, gameType, gameDate, location, thumbnailUrl } = await req.json();
  if (!userId) return NextResponse.json({ error: "Missing userId." }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase.from("analysis_jobs").insert({
    user_id: userId, status: "queued", file_name: fileName ?? null, sport: sport ?? null,
    team_id: teamId ?? null, opponent_name: opponentName ?? null, game_type: gameType ?? null,
    game_date: gameDate ?? null, location: location ?? null, thumbnail_url: thumbnailUrl ?? null,
  }).select("id").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ jobId: data.id });
}
