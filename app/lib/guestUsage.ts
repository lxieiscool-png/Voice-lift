import { createHash } from "crypto";
import { createAdminClient } from "./supabase/admin";
import { clientIp } from "./ratelimit";

// Durable per-IP monthly caps for GUEST (signed-out) usage. Guests have no
// account to meter, so without this one person could burn unlimited free
// analyses by never signing in (or by farming throwaway accounts and using
// the guest path between them). Signed-in users are deliberately NOT capped
// by IP: Reel's core users are teammates sharing school/gym WiFi, and an IP
// cap on accounts would lock out a whole legitimate team at once.
//
// Caps are per IP per calendar month. Generous enough for a curious
// household, tight enough that the guest path can't replace an account.
const GUEST_LIMITS = { clip: 3, game: 1 } as const;
export type GuestKind = keyof typeof GUEST_LIMITS;

const monthKey = () => new Date().toISOString().slice(0, 7);

// Store a hash, not the raw IP — we only ever need equality, never the address.
function ipHash(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

// Returns true if the guest is allowed (and records the use). Fails OPEN on
// any error — a metering hiccup must never block a real person; the burst
// rate limiter still applies either way.
export async function checkAndIncrementGuestUsage(req: Request, kind: GuestKind): Promise<boolean> {
  try {
    const ip = clientIp(req);
    if (!ip) return true; // can't identify caller — fail open
    const hash = ipHash(ip);
    const mk = monthKey();
    const supabase = createAdminClient();

    const { data } = await supabase
      .from("guest_usage").select("clips, games")
      .eq("ip_hash", hash).eq("month_key", mk).maybeSingle();

    const clips = data?.clips ?? 0;
    const games = data?.games ?? 0;
    const current = kind === "clip" ? clips : games;
    if (current >= GUEST_LIMITS[kind]) return false;

    const { error } = await supabase.from("guest_usage").upsert({
      ip_hash: hash,
      month_key: mk,
      clips: kind === "clip" ? clips + 1 : clips,
      games: kind === "game" ? games + 1 : games,
    }, { onConflict: "ip_hash,month_key" });
    if (error) console.error("Guest usage write failed:", error.message);
    return true;
  } catch (e) {
    console.error("Guest usage check failed:", e);
    return true; // fail open
  }
}
