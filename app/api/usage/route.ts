// GET  /api/usage?userId=…&kind=game|clip — non-incrementing status (used by
//      the client for a courtesy pre-check so it can show the upgrade modal
//      before starting work).
// POST /api/usage { userId, kind } — check + increment. Kept for compatibility,
//      but the authoritative spend gate now lives in the routes that actually
//      cost money (/api/jobs/start for games, /api/analyze for clips).

import { NextRequest, NextResponse } from "next/server";
import { getUsage, checkAndIncrementUsage, USAGE_LIMITS, type UsageKind } from "../../lib/usage";

function parseKind(v: string | null | undefined): UsageKind {
  return v === "game" ? "game" : "clip";
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  const kind = parseKind(req.nextUrl.searchParams.get("kind"));
  if (!userId) return NextResponse.json({ ok: true, count: 0, is_pro: false, limit: USAGE_LIMITS[kind].free, kind });
  const s = await getUsage(userId, kind);
  return NextResponse.json({ ok: s.ok, count: s.count, is_pro: s.isPro, limit: s.limit, kind: s.kind });
}

export async function POST(req: NextRequest) {
  const { userId, kind: rawKind } = await req.json();
  const kind = parseKind(rawKind);
  if (!userId) return NextResponse.json({ ok: true, count: 0, is_pro: false, limit: USAGE_LIMITS[kind].free, kind });
  const s = await checkAndIncrementUsage(userId, kind);
  return NextResponse.json({ ok: s.ok, count: s.count, is_pro: s.isPro, limit: s.limit, kind: s.kind },
    { status: s.ok ? 200 : 403 });
}
