import { NextResponse } from "next/server";
import { isRateLimited } from "../../lib/ratelimit";

function extractVideoId(url: string): string | null {
  const raw = url.trim();

  // Try proper URL parsing first — handles ?app=desktop&v=ID, &si= share params, m.youtube.com, etc.
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    if (/(^|\.)youtube\.com$|(^|\.)youtube-nocookie\.com$/.test(u.hostname)) {
      const v = u.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const pathMatch = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([a-zA-Z0-9_-]{11})/);
      if (pathMatch) return pathMatch[1];
    }
    if (/(^|\.)youtu\.be$/.test(u.hostname)) {
      const m = u.pathname.match(/^\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch { /* fall through to regex */ }

  // Regex fallback for anything URL() couldn't parse
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/(?:embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractStoryboardSpec(html: string): string | null {
  // Find the spec string directly — more reliable than parsing the full JSON
  const marker = '"spec":"';
  const start = html.indexOf(marker);
  if (start === -1) return null;

  let i = start + marker.length;
  let result = "";
  while (i < html.length && html[i] !== '"') {
    if (html[i] === "\\") {
      i++;
      if (html[i] === "u") {
        // Unicode escape like &
        const hex = html.slice(i + 1, i + 5);
        result += String.fromCharCode(parseInt(hex, 16));
        i += 5;
        continue;
      }
      result += html[i];
    } else {
      result += html[i];
    }
    i++;
  }
  return result || null;
}

async function fetchAsBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Referer: "https://www.youtube.com/",
      },
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    const ct  = res.headers.get("content-type") || "image/jpeg";
    return `data:${ct};base64,${b64}`;
  } catch {
    return null;
  }
}

// YouTube's internal player API ("innertube") behaves differently per client
// disguise and per IP reputation, and the rules shift constantly — so instead
// of betting on one client, run a gauntlet: try several and take the first
// response that carries a storyboard spec. Duration is collected from whatever
// answers, even when the storyboard is stripped.
const INNERTUBE_CLIENTS: Array<{ label: string; client: Record<string, unknown> }> = [
  { label: "web",      client: { clientName: "WEB", clientVersion: "2.20240401.00.00", hl: "en" } },
  { label: "android",  client: { clientName: "ANDROID", clientVersion: "19.09.37", androidSdkVersion: 34, hl: "en" } },
  { label: "ios",      client: { clientName: "IOS", clientVersion: "19.09.3", deviceModel: "iPhone14,3", hl: "en" } },
  { label: "tv-embed", client: { clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER", clientVersion: "2.0", hl: "en" } },
  { label: "web-embed", client: { clientName: "WEB_EMBEDDED_PLAYER", clientVersion: "1.20240401.00.00", hl: "en" } },
];

type PlayerData = { spec: string | null; duration: number | null; source: string };

async function fetchPlayerDataViaInnertube(videoId: string): Promise<PlayerData> {
  let duration: number | null = null;
  let source = "none";
  for (const { label, client } of INNERTUBE_CLIENTS) {
    try {
      // Minimal headers on purpose: the plain Content-Type-only shape is the
      // one proven to get through from Vercel's IPs. Adding a browser
      // User-Agent without matching browser cookies trips bot detection.
      const res = await fetch("https://www.youtube.com/youtubei/v1/player", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: { client },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const len = parseInt(json?.videoDetails?.lengthSeconds ?? "");
      if (!duration && Number.isFinite(len)) { duration = len; source = `innertube-${label}`; }
      const sb = json?.storyboards;
      const spec = sb?.playerStoryboardSpecRenderer?.spec || sb?.playerLiveStoryboardSpecRenderer?.spec || null;
      if (spec) return { spec, duration: duration ?? (Number.isFinite(len) ? len : null), source: `innertube-${label}` };
    } catch { /* next client */ }
  }
  return { spec: null, duration, source };
}

// The embed player page is served with looser bot-checks than /watch on some
// IP ranges, and its player config carries the same storyboard spec.
async function fetchSpecViaEmbedPage(videoId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.youtube.com/embed/${videoId}?hl=en`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+888; SOCS=CAI",
      },
    });
    if (!res.ok) return null;
    return extractStoryboardSpec(await res.text());
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (isRateLimited(req, "yt", 30)) {
    return NextResponse.json({ error: "Too many requests — try again in a minute." }, { status: 429 });
  }
  try {
    const { url } = await req.json();

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json({ error: "Invalid YouTube URL." }, { status: 400 });
    }


    // Tier 1: innertube player API under several client disguises — the same
    // channel that reliably answers duration queries from Vercel's IPs.
    let specSource = "none";
    const player = await fetchPlayerDataViaInnertube(videoId);
    let rawSpec: string | null = player.spec;
    let knownDuration: number | null = player.duration;
    if (rawSpec) specSource = player.source;

    // Tier 2: scrape the watch page (consent cookies help avoid the redirect
    // interstitial that hides video data from datacenter IPs like Vercel's)
    if (!rawSpec) {
      try {
        const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+888; SOCS=CAI",
          },
        });
        if (pageRes.ok) rawSpec = extractStoryboardSpec(await pageRes.text());
        if (rawSpec) specSource = "watch-page";
      } catch { /* fall through */ }
    }

    // Tier 3: the embed player page — looser bot-checks on some IP ranges.
    if (!rawSpec) {
      rawSpec = await fetchSpecViaEmbedPage(videoId);
      if (rawSpec) specSource = "embed-page";
    }

    // Tier 4: static thumbnails — always publicly served, never bot-checked.
    // Only 4 frames (start/25%/50%/75%), so quality is limited but it works.
    if (!rawSpec) {
      // With only 4 thumbnails, analyzing anything but a confirmed-short clip
      // silently produces a garbage 3-player "analysis" — refuse honestly
      // when the video is long OR we can't verify its length.
      if (!knownDuration || knownDuration > 120) {
        return NextResponse.json({ error: "YouTube wouldn't share enough of this video to analyze it properly — that happens a lot with full games. Upload the video file instead to get the complete report (that's also our sharpest analysis)." }, { status: 400 });
      }
      const thumbUrls = ["hqdefault", "hq1", "hq2", "hq3"].map(
        n => `https://i.ytimg.com/vi/${videoId}/${n}.jpg`
      );
      const thumbs = (await Promise.all(thumbUrls.map(fetchAsBase64))).filter(Boolean) as string[];
      if (thumbs.length >= 2) {
        return NextResponse.json({
          sheets: thumbs, frameWidth: 480, frameHeight: 360,
          rows: 1, cols: 1, frameCount: thumbs.length, interval: 5000,
          durationSeconds: knownDuration ?? 30, mode: "clip", videoId,
        });
      }
      return NextResponse.json({ error: "Could not read video data. The video may be private, age-restricted, or unavailable in your region." }, { status: 400 });
    }

    // Parse the spec
    // Format: baseUrl|w#h#count#cols#rows#interval#name#sigh|...repeat per level
    const parts = rawSpec.split("|");
    const baseUrl = parts[0];
    const levelSpecs = parts.slice(1).filter(Boolean);

    if (!baseUrl || levelSpecs.length === 0) {
      return NextResponse.json({ error: "Could not load video frames." }, { status: 400 });
    }

    // Use highest available level (best quality)
    const levelIdx = levelSpecs.length - 1;
    const levelSpec = levelSpecs[levelIdx];
    const specFields = levelSpec.split("#");
    const frameWidth  = parseInt(specFields[0]) || 160;
    const frameHeight = parseInt(specFields[1]) || 90;
    const frameCount  = parseInt(specFields[2]) || 50;
    const cols        = parseInt(specFields[3]) || 5;
    const rows        = parseInt(specFields[4]) || 5;
    const interval    = parseInt(specFields[5]) || 5000;
    const sigh        = specFields[7] || "";

    const framesPerSheet = rows * cols;
    const totalSheets    = Math.ceil(frameCount / framesPerSheet);

    // Pick up to 20 sheets spread across the video
    const maxSheets = Math.min(20, totalSheets);
    const sheetIndices: number[] = [];
    if (totalSheets <= maxSheets) {
      for (let i = 0; i < totalSheets; i++) sheetIndices.push(i);
    } else {
      const step = totalSheets / maxSheets;
      for (let i = 0; i < maxSheets; i++) sheetIndices.push(Math.floor(i * step));
    }

    // Build sheet URLs and fetch in parallel
    const sheetUrls = sheetIndices.map(n => {
      let u = baseUrl
        .replace(/\$L/g, String(levelIdx))
        .replace(/\$N/g, `M${n}`);
      if (sigh) u += `&sigh=${sigh}`;
      return u;
    });

    const sheets = await Promise.all(sheetUrls.map(fetchAsBase64));
    const validSheets = sheets.filter(Boolean) as string[];

    if (validSheets.length === 0) {
      return NextResponse.json({
        error: "Could not load video frames. Try a different public video.",
      }, { status: 400 });
    }

    const durationSeconds = knownDuration ?? Math.round((frameCount * interval) / 1000);
    const mode: "clip" | "game" = durationSeconds > 60 ? "game" : "clip";

    return NextResponse.json({
      sheets: validSheets,
      frameWidth,
      frameHeight,
      rows,
      cols,
      frameCount,
      interval,
      durationSeconds,
      mode,
      videoId,
      source: specSource,
    });
  } catch (error: any) {
    console.error("YOUTUBE ERROR:", error);
    return NextResponse.json({ error: "Failed to load YouTube video. Make sure it's a public video." }, { status: 500 });
  }
}
