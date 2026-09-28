// TEMPORARY diagnostic (remove once the /admin sign-in issue is fixed).
// Tells the caller only about their OWN request: which cookie NAMES arrived
// (never values) and whether the server could verify their session.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../lib/supabase/server";

export async function GET(req: NextRequest) {
  const names = req.cookies.getAll().map(c => c.name);
  let user: string | null = null, error: string | null = null;
  try {
    const supabase = await createClient();
    const { data, error: e } = await supabase.auth.getUser();
    user = data.user ? `${data.user.id.slice(0, 8)}… (${data.user.email})` : null;
    error = e?.message ?? null;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return NextResponse.json({
    authCookieNames: names.filter(n => n.startsWith("sb-")),
    otherCookieCount: names.filter(n => !n.startsWith("sb-")).length,
    signedInAs: user,
    error,
    supabaseKeyKind: (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").startsWith("sb_publishable_") ? "publishable" : (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "legacy-anon" : "MISSING"),
  }, { headers: { "Cache-Control": "no-store" } });
}
