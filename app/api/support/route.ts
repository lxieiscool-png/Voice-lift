import OpenAI from "openai";
import { isRateLimited } from "../../lib/ratelimit";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Reel's help knowledge base — kept in sync with the actual app so the support
// bot never invents features. Update this when features change.
const KNOWLEDGE = `You are Reel's friendly support assistant. You help people USE the app — not sports coaching (that's the separate "CoachIQ" coach). Be brief, warm, and concrete. 1-3 sentences. If you don't know or it's an account/billing/refund/privacy request you can't resolve, tell them to email support@getreel.org.

HOW REEL WORKS:
- Reel analyzes sports film with AI. Go to the "DecisionIQ" tab, upload a clip (short, ~under a minute) or a full game, and the AI grades every player's decisions and gives coaching.
- Uploading: you can upload a video FILE or paste a YouTube link. For full games, uploading the file is much more reliable and higher quality — YouTube links often fail because YouTube blocks server requests. If a YouTube link fails, there's a "Switch to file upload" button.
- Your video never leaves your device — only still frames are sent to be analyzed, then deleted. Nothing is shared with other users.
- Results: each player gets a grade card. Open a card to see what happened, the coaching read, what to do next time, and "Drills to improve" + "Check my drill" buttons.
- CoachIQ tab: three tools — "Ask Coach" (chat with an AI coach about your game), "Build My Plan" (a weekly solo practice plan), and "Drill Check" (record yourself doing a drill and get form feedback).
- Drill Check: paste or type the drill, optionally turn on "Blur faces" (beta), upload a short clip of yourself doing it, and get a verdict plus what to fix. Your past checks are saved so you can see progress.
- Teams tab: create a team, add a roster, and link your uploaded games to it to track a season record.
- Library tab: all your past analyses, grouped by team, with search and filters.
- Plans: Free = 1 full game + 2 clips per month. Reel Pro ($8/month) = 8 games + 100 clips per month. Upgrade from the upgrade prompt when you hit a limit. To cancel or for refunds, email support@getreel.org.
- Sign in with Google. Guests can try analysis without an account, but need an account to save history, use Teams, or subscribe.

Never make up features that aren't listed here. If asked something outside using Reel, gently steer back or suggest emailing support@getreel.org.`;

export async function POST(req: Request) {
  if (isRateLimited(req, "support", 30)) {
    return Response.json({ error: "Too many requests — try again in a minute." }, { status: 429 });
  }
  try {
    const { messages } = await req.json();
    if (!Array.isArray(messages)) return Response.json({ error: "Missing messages." }, { status: 400 });

    const formatted = messages.slice(-12).map((m: { role: string; content: string }) => ({
      role: (m.role === "bot" ? "assistant" : "user") as "assistant" | "user",
      content: String(m.content ?? "").slice(0, 1000),
    }));

    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      max_tokens: 250,
      temperature: 0.4,
      messages: [{ role: "system", content: KNOWLEDGE }, ...formatted],
    });

    return Response.json({ reply: response.choices[0]?.message?.content ?? "" });
  } catch (error: any) {
    console.error("SUPPORT ERROR:", error);
    return Response.json({ error: error?.message || "Support is unavailable right now." }, { status: 500 });
  }
}
