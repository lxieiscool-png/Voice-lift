// GET  /api/usage?userId=… — returns { count, is_pro, limit }
// POST /api/usage        — increments count, returns { ok, count, is_pro, limit }

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FREE_LIMIT = 2;
const monthKey = () => new Date().toISOString().slice(0, 7); // "2026-06"

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ count: 0, is_pro: false, limit: FREE_LIMIT });

  const { data } = await supabase
    .from("profiles").select("is_pro, monthly_analyses, month_key").eq("id", userId).single();

  const mk     = monthKey();
  const count  = data?.month_key === mk ? (data?.monthly_analyses ?? 0) : 0;
  const is_pro = data?.is_pro ?? false;

  return NextResponse.json({ count, is_pro, limit: FREE_LIMIT });
}

export async function POST(req: NextRequest) {
  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ ok: true, count: 0, is_pro: false, limit: FREE_LIMIT });

  const { data } = await supabase
    .from("profiles").select("is_pro, monthly_analyses, month_key").eq("id", userId).single();

  const mk     = monthKey();
  const is_pro = data?.is_pro ?? false;

  // Pro users bypass tracking
  if (is_pro) return NextResponse.json({ ok: true, count: 0, is_pro: true, limit: FREE_LIMIT });

  // Reset if new month
  const prevCount = data?.month_key === mk ? (data?.monthly_analyses ?? 0) : 0;

  if (prevCount >= FREE_LIMIT) {
    return NextResponse.json({ ok: false, count: prevCount, is_pro: false, limit: FREE_LIMIT }, { status: 403 });
  }

  const newCount = prevCount + 1;
  await supabase.from("profiles")
    .update({ monthly_analyses: newCount, month_key: mk })
    .eq("id", userId);

  return NextResponse.json({ ok: true, count: newCount, is_pro: false, limit: FREE_LIMIT });
}
