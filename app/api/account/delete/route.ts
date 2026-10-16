import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getSessionUserId } from "../../../lib/supabase/server";
import { createAdminClient } from "../../../lib/supabase/admin";
import { rateLimited } from "../../../lib/ratelimit";

// POST /api/account/delete — permanently deletes the signed-in user's account
// and everything tied to it. Also used when the age check finds an under-13
// account, so nothing about the child is kept.
//
// Order matters: billing is stopped first, and if that fails nothing is
// deleted — we never leave someone with a running subscription and no account
// to cancel it from. Identity comes from the session cookie only.
export async function POST(req: Request) {
  if (await rateLimited(req, "account-delete", 5)) {
    return NextResponse.json({ error: "Too many requests — try again in a minute." }, { status: 429 });
  }
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const supabase = createAdminClient();
  const fail = (step: string, detail: unknown) => {
    console.error(`account delete (${step}) failed for ${userId}:`, detail);
    return NextResponse.json(
      { error: "We couldn't finish deleting your account. Email support@getreel.org and we'll complete it for you." },
      { status: 500 },
    );
  };

  // 1. Stop billing. Stripe keeps invoice records itself, as tax law requires.
  const { data: profile } = await supabase.from("profiles").select("stripe_customer_id").eq("id", userId).maybeSingle();
  if (profile?.stripe_customer_id) {
    try {
      if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe not configured");
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-07-29.dahlia" });
      const subs = await stripe.subscriptions.list({ customer: profile.stripe_customer_id, status: "all", limit: 100 });
      for (const s of subs.data) {
        if (s.status !== "canceled" && s.status !== "incomplete_expired") await stripe.subscriptions.cancel(s.id);
      }
    } catch (e) {
      return fail("stripe", e);
    }
  }

  // 2. Files: game thumbnails (public bucket) and any leftover game frames.
  const [{ data: reviews }, { data: jobs }] = await Promise.all([
    supabase.from("reviews").select("thumbnail_url").eq("user_id", userId),
    supabase.from("analysis_jobs").select("id, thumbnail_url").eq("user_id", userId),
  ]);
  const thumbs = [...(reviews ?? []), ...(jobs ?? [])]
    .map(r => r.thumbnail_url?.split("/game-thumbnails/")[1])
    .filter((p): p is string => !!p);
  if (thumbs.length) await supabase.storage.from("game-thumbnails").remove([...new Set(thumbs)]);
  for (const job of jobs ?? []) {
    const { data: frames } = await supabase.storage.from("game-frames").list(job.id, { limit: 1000 });
    if (frames?.length) await supabase.storage.from("game-frames").remove(frames.map(f => `${job.id}/${f.name}`));
  }

  // 3. Rows. Reviews reference teams, so they go before teams.
  const { data: teams } = await supabase.from("teams").select("id").eq("coach_user_id", userId);
  const teamIds = (teams ?? []).map(t => t.id);
  const steps: [string, PromiseLike<{ error: unknown }>][] = [
    ["reviews", supabase.from("reviews").delete().eq("user_id", userId)],
    ["analysis_jobs", supabase.from("analysis_jobs").delete().eq("user_id", userId)],
    ["drill_checks", supabase.from("drill_checks").delete().eq("user_id", userId)],
    ["team_members", supabase.from("team_members").delete().eq("user_id", userId)],
  ];
  for (const [step, q] of steps) {
    const { error } = await q;
    if (error) return fail(step, error);
  }
  if (teamIds.length) {
    // Other people's games may still point at these teams — unlink, don't delete them.
    const unlink = await supabase.from("reviews").update({ team_id: null }).in("team_id", teamIds);
    if (unlink.error) return fail("unlink", unlink.error);
    const members = await supabase.from("team_members").delete().in("team_id", teamIds);
    if (members.error) return fail("team_members", members.error);
    const t = await supabase.from("teams").delete().in("id", teamIds);
    if (t.error) return fail("teams", t.error);
  }
  const p = await supabase.from("profiles").delete().eq("id", userId);
  if (p.error) return fail("profiles", p.error);

  // 4. The login itself.
  const { error: authError } = await supabase.auth.admin.deleteUser(userId);
  if (authError) return fail("auth", authError);

  return NextResponse.json({ ok: true });
}
