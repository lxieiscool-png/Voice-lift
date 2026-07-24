import { createAdminClient } from "./supabase/admin";

// Per-plan monthly caps. Games are the expensive path (a full deep analysis
// costs many times a clip), so they're capped tightly; clips are cheap and get
// a generous ceiling that mainly exists to stop abuse. Pro is capped too — an
// uncapped Pro plan on an $8/mo price is an open-ended cost liability.
export type UsageKind = "game" | "clip";
export const USAGE_LIMITS: Record<UsageKind, { free: number; pro: number }> = {
  game: { free: 1, pro: 8 },
  clip: { free: 2, pro: 100 },
};

const monthKey = () => new Date().toISOString().slice(0, 7); // "2026-07"
const COL: Record<UsageKind, "monthly_games" | "monthly_analyses"> = {
  game: "monthly_games",
  clip: "monthly_analyses",
};

export type UsageStatus = { ok: boolean; count: number; limit: number; isPro: boolean; kind: UsageKind };

// Reads the user's current count for this kind, resetting to 0 if we've rolled
// into a new month since it was last written.
export async function getUsage(userId: string, kind: UsageKind): Promise<UsageStatus> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles").select("is_pro, monthly_games, monthly_analyses, month_key").eq("id", userId).single();
  const isPro = data?.is_pro ?? false;
  const limit = isPro ? USAGE_LIMITS[kind].pro : USAGE_LIMITS[kind].free;
  const count = data?.month_key === monthKey() ? ((data as any)?.[COL[kind]] ?? 0) : 0;
  return { ok: count < limit, count, limit, isPro, kind };
}

// Atomically-ish checks the cap and increments if there's room. This is the
// authoritative spend gate — call it server-side at the point where the
// expensive work is about to start, not just on the client (which is
// bypassable). Rolling into a new month resets both counters.
export async function checkAndIncrementUsage(userId: string, kind: UsageKind): Promise<UsageStatus> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles").select("is_pro, monthly_games, monthly_analyses, month_key").eq("id", userId).single();

  const isPro = data?.is_pro ?? false;
  const limit = isPro ? USAGE_LIMITS[kind].pro : USAGE_LIMITS[kind].free;
  const mk = monthKey();
  const newMonth = data?.month_key !== mk;

  const games = newMonth ? 0 : (data?.monthly_games ?? 0);
  const clips = newMonth ? 0 : (data?.monthly_analyses ?? 0);
  const current = kind === "game" ? games : clips;

  if (current >= limit) return { ok: false, count: current, limit, isPro, kind };

  const next = {
    month_key: mk,
    monthly_games: kind === "game" ? current + 1 : games,
    monthly_analyses: kind === "clip" ? current + 1 : clips,
  };
  await supabase.from("profiles").update(next).eq("id", userId);
  return { ok: true, count: current + 1, limit, isPro, kind };
}
