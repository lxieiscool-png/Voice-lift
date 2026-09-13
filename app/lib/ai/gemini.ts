import { GoogleGenAI } from "@google/genai";

// Provider switch for every AI call in the app, per feature class:
//   AI_PROVIDER_GAMES — game segments, prechecks, synthesis (bulk vision)
//   AI_PROVIDER_CLIPS — the deep clip coaching pass and drill checks
//   AI_PROVIDER_CHAT  — coach chat, plans, drills, how-tos, support
// Each falls back to the global AI_PROVIDER, and everything stays on OpenAI
// when unset or when GEMINI_API_KEY is missing. Rollback is one env var.
export type AiFeature = "games" | "clips" | "chat";

export function useGemini(feature: AiFeature = "games"): boolean {
  if (!process.env.GEMINI_API_KEY) return false;
  const specific = process.env[`AI_PROVIDER_${feature.toUpperCase()}`];
  if (specific) return specific === "gemini";
  return process.env.AI_PROVIDER === "gemini";
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

// 3.7 Flash is brand new and intermittently returns "high demand" 500s;
// 3.6 Flash is the same family at the same price. Try newest first, retry
// transient failures with backoff, then fall through to the older model.
const MODELS = ["gemini-3.7-flash", "gemini-3.6-flash"];

function isTransient(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e);
  // Credit exhaustion also returns 429 but retrying never helps.
  if (/credits? (are )?depleted|prepayment/i.test(msg)) return false;
  return /\b(429|500|503)\b|high demand|overloaded|resource.?exhausted|try again/i.test(msg);
}

// Turn Gemini's API errors into something an athlete can act on.
export function friendlyGeminiError(e: unknown): string {
  const msg = String((e as any)?.message ?? e);
  if (/credits? (are )?depleted|prepayment|billing/i.test(msg)) {
    return "Analysis is temporarily unavailable. Please try again later.";
  }
  if (/private|unlisted|not accessible|permission|forbidden|403/i.test(msg)) {
    return "That video isn't public, so we can't analyze it from the link. Make it public on YouTube, or use Start screen capture instead.";
  }
  if (/not found|invalid|404|unsupported/i.test(msg)) {
    return "We couldn't open that video. Double-check the link, or use Start screen capture instead.";
  }
  return "Couldn't analyze that video. Try Start screen capture instead.";
}

export type ThinkingLevel = "low" | "medium" | "high";

// One generation call: a text prompt plus optional data-URL frames.
// thinking "low" for mechanical extraction (game segments, prechecks, chat),
// "high" for the deep clip coaching pass where reasoning quality shows.
export async function geminiGenerate({ prompt, images = [], videoUrl, videoStart, videoEnd, videoFps, videoResolution, thinking = "low", temperature, maxOutputTokens }: {
  prompt: string;
  images?: string[];
  // A public YouTube URL. Gemini ingests it natively — Google serving Google,
  // so there is nothing to download and nothing for YouTube to block. This is
  // the only path that reads real motion instead of sampled stills.
  videoUrl?: string;
  // Analyze only part of the video, in seconds. Asking one call to cover a
  // whole game makes the model summarize a few highlights instead of logging
  // every possession, so long footage is split into windows.
  videoStart?: number;
  videoEnd?: number;
  // Frames per second Gemini samples. Default is 1; 0.5 halves cost.
  videoFps?: number;
  // Pixels per frame Gemini keeps. Jersey numbers are small and two-digit
  // misreads (6 vs 8, 25 vs 26) come straight from resolution, so analysis
  // asks for "high" rather than the default.
  videoResolution?: "low" | "medium" | "high" | "ultra_high";
  thinking?: ThinkingLevel;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<string> {
  const input: Record<string, unknown>[] = [{ type: "text", text: prompt }];
  if (videoUrl) {
    const video: Record<string, unknown> = { type: "video", uri: videoUrl };
    if (videoResolution) video.resolution = videoResolution;
    if (videoStart !== undefined || videoEnd !== undefined || videoFps !== undefined) {
      // Offsets are duration strings with an "s" suffix ("480s"), not numbers.
      const processing: Record<string, unknown> = { type: "static" };
      if (videoStart !== undefined) processing.start_offset = `${Math.max(0, Math.floor(videoStart))}s`;
      if (videoEnd !== undefined) processing.end_offset = `${Math.ceil(videoEnd)}s`;
      if (videoFps !== undefined) processing.fps = videoFps;
      video.processing = processing;
    }
    input.push(video);
  }
  for (const url of images) {
    const m = /^data:(image\/\w+);base64,(.+)$/.exec(url);
    if (!m) continue;
    input.push({ type: "image", data: m[2], mime_type: m[1] });
  }

  const generation_config: Record<string, unknown> = { thinking_level: thinking };
  if (temperature !== undefined) generation_config.temperature = temperature;
  if (maxOutputTokens !== undefined) generation_config.max_output_tokens = maxOutputTokens;

  let lastError: unknown;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const interaction = await (getClient() as any).interactions.create({
          model,
          input,
          generation_config,
        });
        const text: string = (interaction as any)?.output_text ?? "";
        if (!text.trim()) {
          // Most likely a safety block — surface it as a real error so metered
          // callers refund and the user sees a retryable failure, not silence.
          throw new Error("The AI returned no output for this request. Please try again.");
        }
        return text;
      } catch (e) {
        lastError = e;
        if (!isTransient(e)) throw e;
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

// Flatten a system prompt + chat history into a single transcript prompt.
// Keeps the chat features provider-agnostic without depending on each
// provider's multi-turn message format.
export function flattenChat(system: string, messages: { role: string; content: string }[]): string {
  const transcript = messages
    .map((m) => `${m.role === "assistant" ? "Coach" : "Athlete"}: ${m.content}`)
    .join("\n\n");
  return `${system}\n\n--- CONVERSATION SO FAR ---\n${transcript}\n\nReply as the Coach. Output only your reply text — no "Coach:" prefix.`;
}
