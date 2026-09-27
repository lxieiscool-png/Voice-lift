// IP rate limiting for the AI/cost endpoints — protection against someone
// scripting requests to run up the OpenAI/Gemini bill.
//
// Two layers:
//  1. In-memory buckets per warm instance: free, instant, rejects a naive
//     flood before it costs a database round trip.
//  2. Durable counters in Postgres (hit_rate_limit RPC): the real limit. Holds
//     across every serverless instance and cold start, with a per-minute and
//     a per-day window per IP.
// Both fail OPEN — any doubt and the request is allowed, so a database hiccup
// can never lock out a real user. Limits are generous; a person analyzing
// several clips never gets near them. What this can't stop is one attacker
// rotating through thousands of IPs — provider spending caps cover that.

import { createHash } from "crypto";
import { createAdminClient } from "./supabase/admin";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// Opportunistic cleanup so the map can't grow unbounded on a long-lived instance.
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

export function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

// Store a hash, not the raw IP — we only ever need equality, never the address.
export function ipHash(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

// In-memory layer. Returns true if the caller is over the limit. Never throws.
function memoryLimited(req: Request, key: string, limit: number, windowMs = 60_000): boolean {
  try {
    const ip = clientIp(req);
    if (!ip) return false; // can't identify caller — fail open
    const now = Date.now();
    sweep(now);
    const id = `${key}:${ip}`;
    const b = buckets.get(id);
    if (!b || b.resetAt <= now) {
      buckets.set(id, { count: 1, resetAt: now + windowMs });
      return false;
    }
    b.count += 1;
    return b.count > limit;
  } catch {
    return false; // fail open
  }
}

// A day allows 15 minutes' worth of the per-minute limit: a real user's busy
// session fits easily; a script running all day does not.
const DAY_MULTIPLIER = 15;

async function durableLimited(ip: string, key: string, perMinute: number): Promise<boolean> {
  try {
    const supabase = createAdminClient();
    const id = `${key}:${ipHash(ip)}`;
    const [minute, day] = await Promise.all([
      supabase.rpc("hit_rate_limit", { p_key: `${id}:m`, p_limit: perMinute, p_window_seconds: 60 }),
      supabase.rpc("hit_rate_limit", { p_key: `${id}:d`, p_limit: perMinute * DAY_MULTIPLIER, p_window_seconds: 86_400 }),
    ]);
    // Missing table/function or any error → fail open.
    return minute.data === true || day.data === true;
  } catch {
    return false;
  }
}

// Returns true if the caller is over the limit (reject with 429). perMinute
// is the per-IP allowance per 60s window. Never throws.
export async function rateLimited(req: Request, key: string, perMinute: number): Promise<boolean> {
  const ip = clientIp(req);
  if (!ip) return false; // can't identify caller — fail open
  if (memoryLimited(req, key, perMinute)) return true;
  return durableLimited(ip, key, perMinute);
}
