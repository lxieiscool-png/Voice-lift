import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  try {
    const { sport, position, level, daysPerWeek, weaknesses, profile } = await req.json();

    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: `You are CoachIQ — an elite sports coach building hyper-personalized practice plans inside the Reel platform. You speak directly to the athlete using "you" and "your." Every recommendation is specific to their sport, position, and weaknesses.

NON-NEGOTIABLE RULE: Every single drill must be doable COMPLETELY ALONE with zero special equipment. No cones, no resistance bands, no weight room, no teammates, no coach needed. Assume this athlete may only have: their body, open space (driveway, park, backyard, bedroom), and a standard ball if their sport uses one. If you recommend something that requires equipment or a partner, you've failed.

Your drills must directly address the specific weaknesses given — not generic fitness work. Make every session feel like it was built exactly for this athlete.

CRITICAL FORMATTING RULE: Output plain text only. Never use markdown — no **bold**, no #headers, no asterisks of any kind. Use the exact field labels given (e.g. "Day 1:", "Focus:", "Drill 1:") with nothing added before or after them.`,
        },
        {
          role: "user",
          content: `Build a ${daysPerWeek || 3}-day weekly practice plan for:

Athlete: ${profile?.name || "Athlete"}
Sport: ${sport || profile?.sport || "Unknown"}
Position: ${position || "Not specified"}
Level: ${level || "Intermediate"}
Key weaknesses: ${weaknesses || "General improvement"}

Use this exact format:

Week Focus: [One specific sentence — what theme or skill this week attacks, tied directly to their weaknesses]

Coach's Note:
[2–3 sentences directly to the athlete. Acknowledge their specific weaknesses, set the intention for the week, and motivate them without being generic. Sound like their coach, not a bot.]

${Array.from({ length: Number(daysPerWeek) || 3 }, (_, i) => `Day ${i + 1}:
Focus: [The specific skill or weakness this day targets — be precise, e.g. "First-step explosiveness and finishing through contact" not just "athleticism"]

Drill 1:
  Name: [Specific drill name]
  How: [Step-by-step instructions — what position to start in, exactly what to do, what "good" looks like]
  Reps: [Exact reps, sets, or timed duration]
  Why: [One sentence connecting this drill to their specific weakness]

Drill 2:
  Name: [Specific drill name]
  How: [Step-by-step instructions]
  Reps: [Exact reps/duration]
  Why: [One sentence — why this drill, why now]

Drill 3:
  Name: [Specific drill name]
  How: [Step-by-step instructions]
  Reps: [Exact reps/duration]
  Why: [One sentence]
`).join("\n")}

Make each day build on the last. Day 1 should be foundational, Day 2 intermediate, Day 3 (and beyond) should push harder or combine skills. Every drill must be sport-specific and directly target their listed weaknesses.`,
        },
      ],
      max_tokens: 4000,
      temperature: 0.6,
    });

    return Response.json({ plan: response.choices[0]?.message?.content ?? "" });
  } catch (error: any) {
    console.error("PLAN ERROR:", error);
    return Response.json({ error: error?.message || "Plan generation failed." }, { status: 500 });
  }
}
