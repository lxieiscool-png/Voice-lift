import OpenAI from "openai";
import { geminiGenerate, flattenChat, useGemini } from "./gemini";
import { fastChat } from "./openaiModels";

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
  if (useGemini("chat")) {
    const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
    const rest = messages.filter(m => m.role !== "system");
    const prompt = rest.length === 1 && rest[0].role === "user"
      ? `${system}\n\n${rest[0].content}`
      : flattenChat(system, rest);
    return plainText(await geminiGenerate({ prompt, thinking: "low", temperature, maxOutputTokens: maxTokens }));
  }

  const response = await fastChat(openai, { messages, maxTokens, temperature });
  return plainText(response.choices[0]?.message?.content ?? "");
}

// Every chat surface renders replies as plain text, so markdown emphasis and
// headings would show up as literal ** and #. Newer models add them freely.
// "- " list lines are left alone — the drills parser relies on them.
function plainText(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "");
}
