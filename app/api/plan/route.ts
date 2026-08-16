import OpenAI from "openai";
import { isRateLimited } from "../../lib/ratelimit";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  if (isRateLimited(req, "plan", 15)) {
    return Response.json({ error: "Too many requests — try again in a minute." }, { status: 429 });
  }
  try {
    const body = await req.json();
    const { profile } = body;
    // Clamp everything that reaches the prompt: daysPerWeek drives how many
    // day-blocks get generated (an unclamped value builds a giant prompt and
    // a giant completion), and the strings are interpolated verbatim.
    const days = Math.min(7, Math.max(1, Number(body.daysPerWeek) || 3));
    const sport = typeof body.sport === "string" ? body.sport.slice(0, 40) : "";
    const position = typeof body.position === "string" ? body.position.slice(0, 60) : "";
    const level = typeof body.level === "string" ? body.level.slice(0, 40) : "";
    const weaknesses = typeof body.weaknesses === "string" ? body.weaknesses.slice(0, 1000) : "";

    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: `You are CoachIQ — an elite sports coach building hyper-personalized practice plans inside the Reel platform. You speak directly to the athlete using "you" and "your." Every recommendation is specific to their sport, position, and weaknesses.

NON-NEGOTIABLE RULE: Every single drill must be doable COMPLETELY ALONE with zero special equipment. No cones, no resistance bands, no weight room, no teammates, no coach needed. Assume this athlete may only have: their body, open space (driveway, park, backyard, bedroom), and a standard ball if their sport uses one. If you recommend something that requires equipment or a partner, you've failed.

Your drills must directly address the specific weaknesses given — not generic fitness work. Make every session feel like it was built exactly for this athlete.

Reel's specialty sports are basketball and volleyball — build those plans with specialist depth and correct positional terminology. Volleyball solo work is very doable: wall blocking footwork, platform/passing reps against a wall, setting to yourself with a target spot, approach-and-swing footwork with no net, serving toss consistency, defensive base-to-move reps. Never prescribe a drill that actually needs a net, a partner tossing, or a court if the athlete may not have one.

CRITICAL FORMATTING RULE: Output plain text only. Never use markdown — no **bold**, no #headers, no asterisks of any kind. Use the exact field labels given (e.g. "Day 1:", "Focus:", "Drill 1:") with nothing added before or after them.`,
        },
        {
          role: "user",
          content: `Build a ${days}-day weekly practice plan for:

Athlete: ${String(profile?.name || "Athlete").slice(0, 60)}
Sport: ${sport || String(profile?.sport ?? "").slice(0, 40) || "Unknown"}
Position: ${position || "Not specified"}
Level: ${level || "Intermediate"}
Key weaknesses: ${weaknesses || "General improvement"}

Use this exact format:

Week Focus: [One specific sentence — what theme or skill this week attacks, tied directly to their weaknesses]

Coach's Note:
[One short sentence directly to the athlete. Sound like their coach, not a bot. No fluff.]

${Array.from({ length: days }, (_, i) => `Day ${i + 1}:
Focus: [The specific skill or weakness this day targets — be precise, e.g. "First-step explosiveness and finishing through contact" not just "athleticism"]

Drill 1:
  Name: [Specific drill name]
  How: [ONE short sentence — just what to do. No fluff.]
  Reps: [Exact reps, sets, or timed duration]
  Why: [Half a sentence connecting it to their weakness]

Drill 2:
  Name: [Specific drill name]
  How: [ONE short sentence]
  Reps: [Exact reps/duration]
  Why: [Half a sentence]

Drill 3:
  Name: [Specific drill name]
  How: [ONE short sentence]
  Reps: [Exact reps/duration]
  Why: [Half a sentence]
`).join("\n")}

Keep every line short and punchy — write like a coach handing an athlete a workout card, not an essay. Each day builds on the last. Every drill must be sport-specific, solo, and target their listed weaknesses.`,
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
