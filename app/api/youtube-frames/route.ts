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

interface StoryboardSpec {
  templateUrl: string;
  rows: number;
  cols: number;
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
  interval: number; // ms between frames
}

async function getStoryboardSpec(videoId: string): Promise<StoryboardSpec | null> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const html = await res.text();

    // Extract ytInitialPlayerResponse
    const startIdx = html.indexOf("ytInitialPlayerResponse = ");
    if (startIdx === -1) return null;
    const jsonStart = html.indexOf("{", startIdx);
    // Find matching closing brace
    let depth = 0, jsonEnd = jsonStart;
    for (let i = jsonStart; i < Math.min(jsonStart + 500000, html.length); i++) {
      if (html[i] === "{") depth++;
      else if (html[i] === "}") { depth--; if (depth === 0) { jsonEnd = i; break; } }
    }
    const match = [null, html.slice(jsonStart, jsonEnd + 1)] as [null, string] | null;
    if (!match || !match[1]) return null;

    const playerResponse = JSON.parse(match[1]);
    const spec: string | undefined =
      playerResponse?.storyboards?.playerStoryboardSpecRenderer?.spec ||
      playerResponse?.storyboards?.playerLiveStoryboardSpecRenderer?.spec;

    if (!spec) return null;

    // Parse the spec string — format:
    // baseUrl|w#h#count#cols#rows#interval#nameReplacement#sigh
    const parts = spec.split("|");
    const baseUrl = parts[0];
    if (!parts[1]) return null;

    // Use the highest quality level available (last segment)
    const levels = parts.slice(1);
    const lastLevel = levels[levels.length - 1];
    const [w, h, count, cols, rows, intervalStr] = lastLevel.split("#");

    const levelIndex = levels.length; // 1-based level

    // Replace $N with level index in the base URL
    const templateUrl = baseUrl.replace("$N", `M${levelIndex - 1}`).replace("$L", String(levelIndex - 1));

    return {
      templateUrl,
      rows: parseInt(rows) || 5,
      cols: parseInt(cols) || 5,
      frameCount: parseInt(count) || 100,
      frameWidth: parseInt(w) || 160,
      frameHeight: parseInt(h) || 90,
      interval: parseInt(intervalStr) || 5000,
    };
  } catch {
    return null;
  }
}

async function fetchStoryboardSheet(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Referer: "https://www.youtube.com/",
      },
    });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const contentType = res.headers.get("content-type") || "image/jpeg";
    return `data:${contentType};base64,${base64}`;
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

    const spec = await getStoryboardSpec(videoId);
    if (!spec) {
      return NextResponse.json({ error: "Could not load video. Make sure it's public and not age-restricted." }, { status: 400 });
    }

    // Figure out how many sheets there are and fetch a spread of them
    const framesPerSheet = spec.rows * spec.cols;
    const totalSheets = Math.ceil(spec.frameCount / framesPerSheet);

    // Pick up to 8 sheets spread across the video
    const maxSheets = Math.min(8, totalSheets);
    const step = Math.max(1, Math.floor(totalSheets / maxSheets));
    const sheetIndices: number[] = [];
    for (let i = 0; i < totalSheets; i += step) {
      sheetIndices.push(i);
      if (sheetIndices.length >= maxSheets) break;
    }

    // Fetch sheets in parallel
    const sheets = await Promise.all(
      sheetIndices.map(async (sheetIdx) => {
        const sheetUrl = spec.templateUrl
          .replace(/\$M\d*/, `M${sheetIdx}`)
          .replace(/M\d+(?=\.\w+$)/, `M${sheetIdx}`)
          || spec.templateUrl + `&sn=M${sheetIdx}`;

        // Try the URL with the sheet number replaced at the end
        const urlWithSheet = spec.templateUrl.replace(/M\d+/, `M${sheetIdx}`);
        return await fetchStoryboardSheet(urlWithSheet);
      })
    );

    const validSheets = sheets.filter(Boolean) as string[];

    if (validSheets.length === 0) {
      return NextResponse.json({ error: "Could not load video frames. The video may be private or restricted." }, { status: 400 });
    }

    // Estimate duration from interval and frame count
    const durationSeconds = Math.round((spec.frameCount * spec.interval) / 1000);
    const mode: "clip" | "game" = durationSeconds > 60 ? "game" : "clip";

    return NextResponse.json({
      sheets: validSheets,
      frameWidth: spec.frameWidth,
      frameHeight: spec.frameHeight,
      rows: spec.rows,
      cols: spec.cols,
      frameCount: spec.frameCount,
      interval: spec.interval,
      durationSeconds,
      mode,
      videoId,
    });
  } catch (error: any) {
    console.error("YOUTUBE ERROR:", error);
    return NextResponse.json({ error: "Failed to load YouTube video." }, { status: 500 });
  }
}
