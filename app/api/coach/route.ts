import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  try {
    const { messages, profile, recentPatterns } = await req.json();

    const systemPrompt = `You are CoachIQ — an elite, encouraging personal sports coach inside the Reel platform.

${profile?.name ? `You are coaching ${profile.name}.` : ""}
${profile?.sport ? `Their primary sport is ${profile.sport}.` : ""}
${profile?.team ? `They play for ${profile.team}.` : ""}
${recentPatterns?.length ? `Based on their recent film analysis, these patterns have been flagged for improvement: ${recentPatterns.join(", ")}.` : ""}

Your job:
- Answer any sports coaching question directly and specifically
- Give real, actionable advice — not generic tips
- Be encouraging but honest
- Use correct sport-specific terminology
- Reference their profile and recent patterns when relevant
- Keep responses concise and focused (2–4 short paragraphs max)
- Speak like a great coach, not a textbook

If they ask about a drill, describe it specifically: name, how to do it, reps/duration, what it develops.
IMPORTANT: Any drill you recommend must be something they can do ALONE with no special equipment — no cones, no pads, no gym, no teammates needed. Use only their body, a wall, a ball if their sport uses one, or basic household items. Many athletes using Reel don't have access to facilities or equipment. Always design for the athlete who has nothing but themselves and open space.
If they ask about strategy, break it down tactically.
If they're frustrated or struggling, acknowledge it and motivate them.`;

    const formattedMessages = messages.map((m: { role: string; content: string }) => ({
      role: m.role === "coach" ? "assistant" : "user",
      content: m.content,
    }));

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...formattedMessages,
      ],
      max_tokens: 500,
    });

    return Response.json({ reply: response.choices[0]?.message?.content ?? "No response." });
  } catch (error: any) {
    console.error("COACH ERROR:", error);
    return Response.json({ error: error?.message || "Coach failed to respond." }, { status: 500 });
  }
}
