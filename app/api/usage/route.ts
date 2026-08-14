// GET /api/usage?kind=game|clip — non-incrementing status for the signed-in
// user (used by the client for a courtesy pre-check so it can show the upgrade
// modal before starting work). Identity comes from the session cookie only —
// exposing arbitrary users' counts (or incrementing them) by userId was an
// abuse vector, so the old userId param is ignored and the POST increment
// endpoint (dead code — no client called it) is gone.

import { NextRequest, NextResponse } from "next/server";
import { getUsage, USAGE_LIMITS, type UsageKind } from "../../lib/usage";
import { getSessionUserId } from "../../lib/supabase/server";

function parseKind(v: string | null | undefined): UsageKind {
  return v === "game" ? "game" : "clip";
}

export async function GET(req: NextRequest) {
  const kind = parseKind(req.nextUrl.searchParams.get("kind"));
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ ok: true, count: 0, is_pro: false, limit: USAGE_LIMITS[kind].free, kind });
  const s = await getUsage(userId, kind);
  return NextResponse.json({ ok: s.ok, count: s.count, is_pro: s.isPro, limit: s.limit, kind: s.kind });
}
