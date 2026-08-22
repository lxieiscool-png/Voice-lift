import OpenAI from "openai";
import { geminiGenerate, flattenChat, useGemini } from "./gemini";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

// Provider-agnostic text completion for the chat-style features (coach,
// plans, drills, how-tos, support). Takes OpenAI-shaped messages; on Gemini
// the system prompt and history are flattened into a single transcript
// prompt, which these short exchanges tolerate well.
export async function chatComplete({ messages, maxTokens, temperature }: {
  messages: ChatMsg[];
  maxTokens: number;
  temperature: number;
}): Promise<string> {
  if (useGemini()) {
    const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
    const rest = messages.filter(m => m.role !== "system");
    const prompt = rest.length === 1 && rest[0].role === "user"
      ? `${system}\n\n${rest[0].content}`
      : flattenChat(system, rest);
    return await geminiGenerate({ prompt, thinking: "low", temperature, maxOutputTokens: maxTokens });
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4.1",
    max_tokens: maxTokens,
    temperature,
    messages,
  });
  return response.choices[0]?.message?.content ?? "";
}
