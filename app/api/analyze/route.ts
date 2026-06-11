import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  try {
    const { sport, frames, mode, chunkIndex, chunkStart, chunkEnd } = await req.json();

    const imageInputs = frames.map((frame: string) => ({
      type: "input_image",
      image_url: frame,
    }));

    const isGameMode = mode === "game";

    const prompt = isGameMode
      ? `
You are a professional sports coach reviewing a segment of game film with your athlete.

These frames cover ${chunkStart}–${chunkEnd} (segment ${chunkIndex + 1}).
Sport: ${sport || "auto-detect from frames"}

Analyze only what is visible. If unclear, say "unclear."

Return in this exact format:

Period/Quarter: [visible period/quarter or "unclear"]
Game Clock: [visible clock or "unclear"]
Score: [visible score or "unclear"]

Key Events:
- [foul, call, score, or notable play — include jersey number and team if clearly visible. "None detected" if none.]

Player Tracking:
- [If jersey number is clearly legible: #NUMBER (TEAM). If unclear, use "Blue Guard" style label. Never guess a number. One line per player.]

Decision Quality:
[1–2 sentences speaking directly to the athlete about the decision quality this segment.]

Pattern Noted:
[One tactical pattern visible this segment.]

Keep the full response under 150 words.
`
      : `
You are a professional sports coach analyzing film with your athlete. Speak directly to them — use "you" and "your." Be specific, honest, and encouraging. Focus on what they can control and improve.

Analyze ALL players who made notable decisions — offense AND defense. Be sport-specific in your terminology.

Examples by sport:
- Basketball: steals, blocks, screens, rotations, help defense, pick-and-roll reads
- Soccer: tackles, pressing, through balls, off-ball runs, goalkeeper decisions
- Water polo: blocks, steals, skip passes, driver cuts, goalkeeper positioning
- Football: route running, coverage, block shedding, blitz reads
- Hockey: puck battles, breakouts, positioning, shot selection

For EACH player (2–5 players), return a block in exactly this format:

=== PLAYER ===
Player: [If jersey number is clearly legible, use "#NUMBER (TEAM)". If unclear, use a descriptive label like "Blue Guard" or "White Forward" — NEVER guess a number.]
Role: [specific role — Ball Handler, Help Defender, Shot Blocker, Goalkeeper, Striker, etc.]
Action: [what they did — Drive to basket, Attempted steal, Block, Defensive rotation, Off-ball cut, etc.]
Sport: [detected sport]
Decision Grade: [A+ to F]

What Happened:
[1 sentence describing what occurred — factual, only what is visible.]

Decision Read:
[Speak directly to this player: did they read the situation well? e.g. "You recognized the mismatch early and attacked it — that's exactly the right instinct." or "You hesitated when the lane opened, which gave the defender time to recover."]

Best Alternative:
[Coach them on what to do next time: "Next time, look to..." or "The better read here was..."]

Why It Was Better:
[Brief tactical reason a coach would give.]

Other Options:
- [Option 1]
- [Option 2]

Pattern To Improve:
[One habit to work on, spoken as a coach: "The thing to keep working on is..."]

Practice Focus:
[One specific drill the athlete can do ALONE with no equipment or basic household items. No cones, no pads, no teammates required. Make it something they can do in their driveway, backyard, bedroom, or a park. Be specific: name the drill, how many reps, and what to focus on mentally while doing it.]
=== END ===

Sport: ${sport || "auto-detect from frames"}
Keep each player block under 130 words.
`;

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            ...imageInputs,
          ],
        },
      ],
    });

    return Response.json({ feedback: response.output_text });
  } catch (error: any) {
    console.error("OPENAI ERROR:", error);
    return Response.json({ error: error?.message || "Analysis failed." }, { status: 500 });
  }
}
