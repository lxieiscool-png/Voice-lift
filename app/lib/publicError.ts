import { SportsCheckError } from "./analysis/analyzeChunk";
import { DrillCheckError } from "./analysis/analyzeDrill";

// Messages written for users. Anything else — raw OpenAI / Gemini / Supabase
// errors — can carry masked API keys, org and project ids or quota details,
// so it stays in the server log and the user gets the route's fallback.
const USER_FACING = new Set([
  "The AI returned no output for this request. Please try again.",
]);

export function publicErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof SportsCheckError || error instanceof DrillCheckError) return error.message;
  const msg = (error as { message?: unknown } | null)?.message;
  return typeof msg === "string" && USER_FACING.has(msg) ? msg : fallback;
}
