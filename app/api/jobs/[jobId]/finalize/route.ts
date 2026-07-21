import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { inngest } from "../../../../lib/inngest/client";

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const { userId, frameCount, timestamps, jersey, teamColor, teamsNote, lenient } = await req.json();
  if (!userId || !frameCount) return NextResponse.json({ error: "Missing userId or frameCount." }, { status: 400 });

  const supabase = createAdminClient();
  const { error } = await supabase.from("analysis_jobs")
    .update({ status: "queued", progress_total: frameCount })
    .eq("id", jobId).eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await inngest.send({
    name: "game/analysis.requested",
    data: { jobId, userId, frameCount, timestamps, jersey, teamColor, teamsNote, lenient },
  });

  return NextResponse.json({ ok: true });
}
