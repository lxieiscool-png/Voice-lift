import { GoogleGenAI } from "@google/genai";

// Provider switch for every AI call in the app. Flipping AI_PROVIDER=gemini
// in the environment routes analysis through Gemini 3.7 Flash; anything else
// (or a missing GEMINI_API_KEY) stays on OpenAI. One env var, instant
// rollback, no code changes.
export function useGemini(): boolean {
  return process.env.AI_PROVIDER === "gemini" && !!process.env.GEMINI_API_KEY;
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
  return /\b(429|500|503)\b|high demand|overloaded|resource.?exhausted|try again/i.test(msg);
}

export type ThinkingLevel = "low" | "medium" | "high";

// One generation call: a text prompt plus optional data-URL frames.
// thinking "low" for mechanical extraction (game segments, prechecks, chat),
// "high" for the deep clip coaching pass where reasoning quality shows.
export async function geminiGenerate({ prompt, images = [], thinking = "low", temperature, maxOutputTokens }: {
  prompt: string;
  images?: string[];
  thinking?: ThinkingLevel;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<string> {
  const input: Record<string, unknown>[] = [{ type: "text", text: prompt }];
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
