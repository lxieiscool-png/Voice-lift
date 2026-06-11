import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  try {
    const { sport, chunkSummaries } = await req.json();

    const summaryText = chunkSummaries
      .map((s: { index: number; start: string; end: string; text: string }) =>
        `--- Segment ${s.index + 1} (${s.start}–${s.end}) ---\n${s.text}`
      )
      .join("\n\n");

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `
You are a professional sports coach delivering a full game review to your athlete after watching game film together. Speak directly to them — use "you" and "your." Be specific, honest, encouraging, and growth-focused. This athlete may not have access to a real coach — your feedback could make a real difference.

Sport: ${sport || "auto-detected"}

Segment summaries:
${summaryText}

Produce a complete Game Report in this exact format:

Overall Decision Grade: [A+ to F]

Game Summary:
[2–3 sentences talking directly to the athlete about their overall game — what stood out, how the game flowed for them.]

Period Breakdown:
[Walk through each period or quarter as a coach would. If periods were unclear, break into early/middle/late game.]

Foul & Call Patterns:
[Coach them on foul trends — what fouls they drew, committed, or missed. Be specific.]

Decision Trends:
[How did your decision-making change as the game went on? Speak to the athlete about what you noticed.]

Top 3 Strengths:
- [Strength 1 — specific and encouraging]
- [Strength 2]
- [Strength 3]

Top 3 Areas To Improve:
- [Area 1 — specific and actionable]
- [Area 2]
- [Area 3]

Game-Level Practice Focus:
[One solo drill the athlete can do completely alone with no equipment or basic household items — no cones, no pads, no teammates. Something they can do in a driveway, park, bedroom, or backyard. Name the drill, the reps, and what to focus on mentally.]

Player Stats:
- [#NUMBER (TEAM) | Decisions: X good / Y poor | Fouls: Z | Key plays: brief note]
- [Repeat for every player identified by jersey number. "No jersey numbers detected." if none.]

Keep the full response under 400 words.
`,
            },
          ],
        },
      ],
    });

    return Response.json({ report: response.output_text });
  } catch (error: any) {
    console.error("SYNTHESIZE ERROR:", error);
    return Response.json({ error: error?.message || "Synthesis failed." }, { status: 500 });
  }
}
