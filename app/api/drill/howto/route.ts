import OpenAI from "openai";
import { isRateLimited } from "../../../lib/ratelimit";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// POST /api/drill/howto { drill, sport }
// Step-by-step instructions for a prescribed solo drill. Text-only and cheap
// (fractions of a cent), so unmetered — same policy as /api/coach chat.
export async function POST(req: Request) {
  if (isRateLimited(req, "howto", 20)) {
    return Response.json({ error: "Too many requests — try again in a minute." }, { status: 429 });
  }
  try {
    const body = await req.json();
    const drill = typeof body.drill === "string" ? body.drill.slice(0, 1000) : "";
    const sport = typeof body.sport === "string" ? body.sport.slice(0, 40) : "";
    if (!drill.trim()) return Response.json({ error: "Missing drill." }, { status: 400 });

    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      max_tokens: 400,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `You are a skills coach explaining a solo practice drill to a young athlete so they can do it correctly alone, with no equipment beyond their body, open space, and a ball if their sport uses one. Plain text only — no markdown, no asterisks. Keep every line short and concrete. If the drill as described genuinely can't be done solo, adapt it into the closest solo version and say so in the first step.`,
        },
        {
          role: "user",
          content: `Drill: ${drill.trim()}
Sport: ${sport || "not specified"}

Explain exactly how to do it, in this exact format:

Setup: [one line — where to stand, what you need]
Steps:
1. [short concrete action]
2. [short concrete action]
3. [3-6 steps total, each one line]
Common Mistakes:
- [mistake 1, one line]
- [mistake 2, one line]
Cue: [the ONE thing to hold in your mind every rep]`,
        },
      ],
    });

    return Response.json({ howto: response.choices[0]?.message?.content ?? "" });
  } catch (error: any) {
    console.error("DRILL HOWTO ERROR:", error);
    return Response.json({ error: error?.message || "Couldn't build instructions." }, { status: 500 });
  }
}
