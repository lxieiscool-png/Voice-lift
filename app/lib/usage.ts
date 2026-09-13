import { createAdminClient } from "./supabase/admin";

// Per-plan monthly caps, server-enforced. Games are the expensive path, so
// they're capped tightly; clips are cheap with a ceiling that mainly stops
// abuse. Coach chat and plans are cheap text calls — their free caps exist to
// sell Pro, and their "unlimited" Pro tiers keep a high ceiling purely as an
// abuse backstop (the UI may say unlimited; nobody legitimate hits these).
export type UsageKind = "game" | "clip" | "coach" | "plan";
export const USAGE_LIMITS: Record<UsageKind, { free: number; pro: number }> = {
  game:  { free: 1,  pro: 8 },
  clip:  { free: 2,  pro: 100 },
  coach: { free: 15, pro: 1000 },
  plan:  { free: 1,  pro: 50 },
};

const monthKey = () => new Date().toISOString().slice(0, 7); // "2026-07"
const COL: Record<UsageKind, string> = {
  game:  "monthly_games",
  clip:  "monthly_analyses",
  coach: "monthly_coach_msgs",
  plan:  "monthly_plans",
};
const ALL_COLS = Object.values(COL);
const SELECT_COLS = `is_pro, month_key, ${ALL_COLS.join(", ")}`;

export type UsageStatus = { ok: boolean; count: number; limit: number; isPro: boolean; kind: UsageKind };

// Owner allowlist: comma-separated Supabase user IDs in OWNER_USER_IDS get
// unlimited everything and read as Pro across the app (no metering, no upgrade
// prompts). Kept in env, not code, so no email or ID lives in the repo and
// adding an owner is a dashboard change, not a deploy.
function isOwner(userId: string): boolean {
  // Accept either spelling — the plural is the documented name, but the
  // singular is the easy typo and silently disables the bypass otherwise.
  const raw = process.env.OWNER_USER_IDS || process.env.OWNER_USER_ID || "";
  return raw.split(",").map(s => s.trim()).filter(Boolean).includes(userId);
}

const OWNER_STATUS = (kind: UsageKind): UsageStatus =>
  ({ ok: true, count: 0, limit: Infinity, isPro: true, kind });

// Reads the user's current count for this kind, resetting to 0 if we've rolled
// into a new month since it was last written.
export async function getUsage(userId: string, kind: UsageKind): Promise<UsageStatus> {
  if (isOwner(userId)) return OWNER_STATUS(kind);
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles").select(SELECT_COLS).eq("id", userId).single();
  const row = data as Record<string, any> | null;
  const isPro = row?.is_pro ?? false;
  const limit = isPro ? USAGE_LIMITS[kind].pro : USAGE_LIMITS[kind].free;
  const count = row?.month_key === monthKey() ? (row?.[COL[kind]] ?? 0) : 0;
  return { ok: count < limit, count, limit, isPro, kind };
}

// Atomically-ish checks the cap and increments if there's room. This is the
// authoritative spend gate — call it server-side at the point where the
// metered work is about to start. Rolling into a new month resets every
// counter, so the whole row stays coherent no matter which kind rolls first.
export async function checkAndIncrementUsage(userId: string, kind: UsageKind): Promise<UsageStatus> {
  // Owners never consume credits — return allowed without touching the counter.
  if (isOwner(userId)) return OWNER_STATUS(kind);
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles").select(SELECT_COLS).eq("id", userId).single();
  const row = data as Record<string, any> | null;

  const isPro = row?.is_pro ?? false;
  const limit = isPro ? USAGE_LIMITS[kind].pro : USAGE_LIMITS[kind].free;
  const mk = monthKey();
  const newMonth = row?.month_key !== mk;

  const counts: Record<string, number> = {};
  for (const col of ALL_COLS) counts[col] = newMonth ? 0 : (row?.[col] ?? 0);
  const current = counts[COL[kind]];

  if (current >= limit) return { ok: false, count: current, limit, isPro, kind };

  counts[COL[kind]] = current + 1;
  const { error } = await supabase.from("profiles").update({ month_key: mk, ...counts }).eq("id", userId);
  if (error) {
    // Most likely the coach/plan columns haven't been migrated yet — retry
    // with only the legacy columns so game/clip gating never breaks, and
    // fail open for the new kinds rather than erroring the request.
    console.error("Usage update failed (missing columns?):", error.message);
    await supabase.from("profiles").update({
      month_key: mk,
      monthly_games: counts.monthly_games,
      monthly_analyses: counts.monthly_analyses,
    }).eq("id", userId);
  }
  return { ok: true, count: current + 1, limit, isPro, kind };
}

// Best-effort refund when the metered work fails after the increment. Never
// throws; a failed refund just costs one credit.
export async function refundUsage(userId: string, kind: UsageKind): Promise<void> {
  try {
    const supabase = createAdminClient();
    const col = COL[kind];
    const { data } = await supabase
      .from("profiles").select(`month_key, ${col}`).eq("id", userId).single();
    const row = data as Record<string, any> | null;
    if (!row || row.month_key !== monthKey()) return; // month rolled — nothing meaningful to refund
    const current = row[col] ?? 0;
    if (current <= 0) return;
    await supabase.from("profiles").update({ [col]: current - 1 }).eq("id", userId);
  } catch (e) {
    console.error("Usage refund failed:", e);
  }
}
