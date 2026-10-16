import { NextResponse } from "next/server";
import { getSessionUserId } from "../../../lib/supabase/server";
import { createAdminClient } from "../../../lib/supabase/admin";

// POST /api/reviews/delete { id } — deletes one of the signed-in user's
// reviews and its thumbnail image. The thumbnail bucket is public and only
// writable server-side, so a client-side row delete used to leave the image
// behind after the user had deleted the game.
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : null;
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });

  const supabase = createAdminClient();
  const { data: review } = await supabase.from("reviews")
    .select("thumbnail_url").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!review) return NextResponse.json({ ok: true }); // already gone, or not theirs

  const path = review.thumbnail_url?.split("/game-thumbnails/")[1];
  if (path) await supabase.storage.from("game-thumbnails").remove([path]);
  const { error } = await supabase.from("reviews").delete().eq("id", id).eq("user_id", userId);
  if (error) {
    console.error("review delete:", error.message);
    return NextResponse.json({ error: "Couldn't delete that game." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
