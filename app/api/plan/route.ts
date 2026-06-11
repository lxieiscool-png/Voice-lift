import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  try {
    const { sport, position, level, daysPerWeek, weaknesses, profile } = await req.json();

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `You are CoachIQ, an elite sports coach building personalized practice plans inside the VoiceLift platform. Speak directly to the athlete using "you" and "your." Be specific, practical, and encouraging.

CRITICAL RULE: Every single drill must be something the athlete can do completely ALONE with no special equipment. No cones, no pads, no resistance bands, no teammates, no gym required. Use only: their own body, a wall, a ball (if their sport uses one), a chair, or items found in any home. Every athlete using VoiceLift may not have access to a gym, a team, or any equipment. Design every drill assuming they have nothing but themselves and open space.`,
        },
        {
          role: "user",
          content: `Build me a weekly practice plan with these details:

Athlete: ${profile?.name || "Athlete"}
Sport: ${sport || profile?.sport || "Unknown"}
Position: ${position || "Not specified"}
Experience Level: ${level || "Intermediate"}
Days available per week: ${daysPerWeek || 3}
Key weaknesses to address: ${weaknesses || "General improvement"}

Return the plan in this exact format:

Week Focus: [one sentence on the theme of this week's training]

Coach's Note:
[2–3 sentences of personal encouragement and context for this plan — speak directly to the athlete]

${Array.from({ length: Number(daysPerWeek) || 3 }, (_, i) => `
Day ${i + 1}:
Focus: [what this session targets]
Drill 1:
  Name: [drill name]
  How: [2–3 sentences on exactly how to do it]
  Reps: [specific reps, sets, or duration]
  Why: [one sentence on what this develops]
Drill 2:
  Name: [drill name]
  How: [2–3 sentences]
  Reps: [reps/duration]
  Why: [one sentence]
Drill 3:
  Name: [drill name]
  How: [2–3 sentences]
  Reps: [reps/duration]
  Why: [one sentence]
`).join("\n")}

Keep drills highly specific to the sport and position. No generic fitness advice. Every drill must be solo and require no equipment beyond what any athlete already has.`,
        },
      ],
      max_tokens: 1200,
    });

    return Response.json({ plan: response.choices[0]?.message?.content ?? "" });
  } catch (error: any) {
    console.error("PLAN ERROR:", error);
    return Response.json({ error: error?.message || "Plan generation failed." }, { status: 500 });
  }
}
