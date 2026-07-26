// Lightweight in-memory IP rate limiter for the AI/cost endpoints. This is a
// blunt instrument against scripted abuse (someone hammering an endpoint to run
// up the OpenAI bill), NOT a precise quota — on serverless it's per-warm-
// instance and resets on cold start, so a determined attacker spread across
// instances gets a higher effective limit. That's fine: it turns a trivial
// "curl in a loop" flood into something much harder, at zero dependency cost.
// Fails OPEN — any doubt and the request is allowed, so it can never wrongly
// block a real user. Limits are deliberately generous (a real person analyzing
// several clips will never hit them). Upgrade to Upstash/Redis if precise,
// distributed limits are ever needed.

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

// Returns true if the caller is over the limit (should be rejected). windowMs
// defaults to 60s. Never throws.
export function isRateLimited(req: Request, key: string, limit: number, windowMs = 60_000): boolean {
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
