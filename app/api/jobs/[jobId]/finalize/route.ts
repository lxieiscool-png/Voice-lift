import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { getSessionUserId } from "../../../../lib/supabase/server";
import { inngest } from "../../../../lib/inngest/client";

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const { frameCount, timestamps, jersey, teamColor, teamsNote, lenient } = await req.json();
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!frameCount) return NextResponse.json({ error: "Missing frameCount." }, { status: 400 });

  const supabase = createAdminClient();
  // Verify ownership explicitly — a filtered update that matches no rows
  // succeeds silently, which would fire the Inngest event for a job that was
  // never queued (or that belongs to someone else).
  const { data: job } = await supabase.from("analysis_jobs").select("user_id").eq("id", jobId).single();
  if (!job || job.user_id !== userId) return NextResponse.json({ error: "Job not found." }, { status: 404 });

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
