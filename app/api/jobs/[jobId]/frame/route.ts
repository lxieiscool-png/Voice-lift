import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { getSessionUserId } from "../../../../lib/supabase/server";

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const { index, dataUrl } = await req.json();
  // 2400 = far above the 400-frame max a real game upload sends; the decoded
  // size cap matches Vercel's ~4.5MB request ceiling minus JSON overhead.
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 2400 || typeof dataUrl !== "string") {
    return NextResponse.json({ error: "Missing or invalid index/dataUrl." }, { status: 400 });
  }

  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!match) return NextResponse.json({ error: "Invalid data URL." }, { status: 400 });
  const [, contentType, base64] = match;
  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength > 3_500_000) return NextResponse.json({ error: "Frame too large." }, { status: 413 });

  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const supabase = createAdminClient();
  // Only the job's owner may upload frames into it.
  const { data: job } = await supabase.from("analysis_jobs").select("user_id").eq("id", jobId).single();
  if (!job || job.user_id !== userId) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  const path = `${jobId}/${String(index).padStart(5, "0")}.jpg`;
  const { error } = await supabase.storage.from("game-frames").upload(path, buffer, {
    contentType, upsert: true,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
