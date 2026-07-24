import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../lib/supabase/admin";

// Uploads a single already-downscaled frame (see captureThumbnail in
// DecisionIQ.tsx) to the public game-thumbnails bucket, for Library/Teams
// card previews. Best-effort by design — callers treat a failure here as
// non-fatal, since a review is still fully usable without a thumbnail.
export async function POST(req: NextRequest) {
  const { dataUrl } = await req.json();
  if (!dataUrl) return NextResponse.json({ error: "Missing dataUrl." }, { status: 400 });

  const match = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl);
  if (!match) return NextResponse.json({ error: "Invalid data URL." }, { status: 400 });
  const [, contentType, base64] = match;
  const buffer = Buffer.from(base64, "base64");

  const supabase = createAdminClient();
  const path = `${randomUUID()}.jpg`;
  const { error } = await supabase.storage.from("game-thumbnails").upload(path, buffer, {
    contentType, upsert: false,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data } = supabase.storage.from("game-thumbnails").getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl });
}
