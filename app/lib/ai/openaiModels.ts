import OpenAI from "openai";

// The everyday OpenAI model for Reel's non-reasoning work: game segments,
// prechecks, drill checks, game reports and the chat features.
//
// gpt-4.1 shuts down on 2027-01-14 (OpenAI deprecations page); gpt-6-luna is
// OpenAI's recommended replacement and costs a fraction of it. It's a
// reasoning model, so it takes `reasoning.effort` instead of `temperature`.
// Effort "none" keeps it as fast and literal as gpt-4.1 was.
//
// Safety net: any error on the new model retries once on gpt-4.1 until the
// shutdown date, so a parameter it rejects or a bad day at OpenAI can't take
// analysis down. OPENAI_FAST_MODEL overrides the model without a code change.
export const FAST_MODEL = process.env.OPENAI_FAST_MODEL || "gpt-6-luna";
const LEGACY_MODEL = "gpt-4.1";
const LEGACY_SHUTDOWN = Date.UTC(2027, 0, 14);

type Effort = "none" | "low" | "medium";

const canFallBack = () => FAST_MODEL !== LEGACY_MODEL && Date.now() < LEGACY_SHUTDOWN;

function fallbackWarning(model: string, e: unknown) {
  console.warn(`${model} failed, retrying on ${LEGACY_MODEL}:`, (e as { message?: string })?.message);
}

// Responses API call (vision + text). `temperature` only applies to the
// gpt-4.1 fallback; the new model is steered by `effort`.
export async function fastResponse(openai: OpenAI, { input, effort = "none", temperature = 0 }: {
  input: OpenAI.Responses.ResponseCreateParams["input"];
  effort?: Effort;
  temperature?: number;
}) {
  try {
    return await openai.responses.create({ model: FAST_MODEL, input, reasoning: { effort } } as OpenAI.Responses.ResponseCreateParamsNonStreaming);
  } catch (e) {
    if (!canFallBack()) throw e;
    fallbackWarning(FAST_MODEL, e);
    return await openai.responses.create({ model: LEGACY_MODEL, input, temperature });
  }
}

// Chat Completions call for the text-only chat features. Reasoning models take
// max_completion_tokens rather than max_tokens.
export async function fastChat(openai: OpenAI, { messages, maxTokens, temperature }: {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  maxTokens: number;
  temperature?: number;
}) {
  try {
    return await openai.chat.completions.create({
      model: FAST_MODEL, messages, max_completion_tokens: maxTokens, reasoning_effort: "none",
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  } catch (e) {
    if (!canFallBack()) throw e;
    fallbackWarning(FAST_MODEL, e);
    return await openai.chat.completions.create({ model: LEGACY_MODEL, messages, max_tokens: maxTokens, temperature });
  }
}
