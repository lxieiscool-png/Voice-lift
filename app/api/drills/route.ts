import OpenAI from "openai";
import { isRateLimited } from "../../lib/ratelimit";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// POST /api/drills { sport, role, focus }
// Generates short drills to fix a specific player weakness, split into solo and
// with-teammates. Text-only and cheap, so unmetered (rate-limited only).
export async function POST(req: Request) {
  if (isRateLimited(req, "drills", 20)) {
    return Response.json({ error: "Too many requests — try again in a minute." }, { status: 429 });
  }
  try {
    const { sport, role, focus } = await req.json();
    if (!focus?.trim()) return Response.json({ error: "Missing focus." }, { status: 400 });

    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      max_tokens: 350,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: `You are a sports skills coach. You generate specific drills to fix one player weakness. HARD RULE: every drill is ONE short sentence — name the drill and its single key focus, nothing more. Never a paragraph, never multiple sentences, no reps/set numbers unless a single number. Plain text only, no markdown, no bullets characters other than the "- " prefix requested.`,
        },
        {
          role: "user",
          content: `Sport: ${sport || "basketball"}
Player role: ${role || "player"}
What to improve: ${focus.trim()}

Give drills that directly fix this, in EXACTLY this format and nothing else:

Solo:
- [one-sentence drill they can do completely alone, no equipment beyond a ball]
- [one-sentence drill]
- [one-sentence drill]

With Teammates:
- [one-sentence drill needing one or more teammates]
- [one-sentence drill]
- [one-sentence drill]`,
        },
      ],
    });

    return Response.json({ drills: response.choices[0]?.message?.content ?? "" });
  } catch (error: any) {
    console.error("DRILLS ERROR:", error);
    return Response.json({ error: error?.message || "Couldn't build drills." }, { status: 500 });
  }
}
