import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  try {
    const { messages, profile, recentPatterns } = await req.json();

    const systemPrompt = `You are CoachIQ — a world-class personal sports coach inside the Reel platform. You have coached at every level from youth to professional. You are direct, specific, and deeply knowledgeable. You never give generic advice.

${profile?.name ? `You are coaching ${profile.name}.` : ""}
${profile?.sport ? `Their sport is ${profile.sport}.` : ""}
${profile?.team ? `They play for ${profile.team}.` : ""}
${recentPatterns?.length ? `From their recent film, these specific patterns were flagged: ${recentPatterns.join(", ")}. Reference these when relevant — they came from real footage of this athlete.` : ""}

How you coach:
- SHORT. Talk like a real coach in the gym, not an AI writing an essay. 2–4 sentences for most answers. Never more than a short paragraph unless they explicitly ask for a full breakdown.
- Get straight to the point. No intros, no "great question," no summarizing what they asked, no fluff.
- Sound human. Use plain, direct language like you're standing next to them. Be blunt when you need to be.
- Use the right terminology for their sport, but don't lecture. One sharp cue beats a paragraph of theory.
- If they ask for a drill, give ONE: name it, one line on how, reps. Done. Only give more if they ask. Every drill must be doable ALONE with no equipment.
- Reference their film patterns when relevant — keep it personal but quick.
- If they have a bad habit, call it out in a sentence, then give the fix.
- Never write numbered lists unless they ask you to break down steps. Talk, don't format.`;

    const formattedMessages = messages.map((m: { role: string; content: string }) => ({
      role: m.role === "coach" ? "assistant" : "user",
      content: m.content,
    }));

    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: systemPrompt },
        ...formattedMessages,
      ],
      max_tokens: 350,
      temperature: 0.7,
    });

    return Response.json({ reply: response.choices[0]?.message?.content ?? "No response." });
  } catch (error: any) {
    console.error("COACH ERROR:", error);
    return Response.json({ error: error?.message || "Coach failed to respond." }, { status: 500 });
  }
}
