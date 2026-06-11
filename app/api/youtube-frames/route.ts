import { NextResponse } from "next/server";

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
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

export async function POST(req: Request) {
  try {
    const { url } = await req.json();

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json({ error: "Invalid YouTube URL." }, { status: 400 });
    }

    // Fetch the YouTube page
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!pageRes.ok) {
      return NextResponse.json({ error: "Could not access this video. It may be private or unavailable." }, { status: 400 });
    }

    const html = await pageRes.text();
    const rawSpec = extractStoryboardSpec(html);

    if (!rawSpec) {
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

    // Pick up to 10 sheets spread across the video
    const maxSheets = Math.min(10, totalSheets);
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

    const durationSeconds = Math.round((frameCount * interval) / 1000);
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
    });
  } catch (error: any) {
    console.error("YOUTUBE ERROR:", error);
    return NextResponse.json({ error: "Failed to load YouTube video. Make sure it's a public video." }, { status: 500 });
  }
}
