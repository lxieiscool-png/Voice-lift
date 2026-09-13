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
You are DecisionIQ, an elite sports analysis AI reviewing a segment of a full game.

Frames cover ${chunkStart}–${chunkEnd} (segment ${chunkIndex + 1}).
Sport: ${sport || "auto-detect from frames"}

Analyze only what is visible. If unclear, say "unclear."

Return in this exact format:

Period/Quarter: [visible period/quarter or "unclear"]
Game Clock: [visible clock or "unclear"]
Score: [visible score or "unclear"]

Key Events:
- [foul, call, score, or notable play — include jersey number and team if visible. "None detected" if none.]

Player Tracking:
- [If jersey number is clearly legible: #NUMBER (TEAM). If unclear, use descriptive label like "Blue Guard" or "White Forward". Never guess a number. One line per player.]

Decision Quality:
[1–2 sentences on decision quality this segment.]

Pattern Noted:
[One tactical pattern visible this segment.]

Keep the full response under 150 words.
`
      : `
You are DecisionIQ, an elite sports decision-analysis AI.

Analyze ALL players who made notable decisions in this play — offense AND defense.
Be sport-specific. Use terminology appropriate to the sport detected.

Examples by sport:
- Basketball: steals, blocks, screens, rotations, help defense, pick-and-roll reads
- Soccer: tackles, pressing, through balls, off-ball runs, goalkeeper decisions
- Water polo: blocks, steals, skip passes, driver cuts, goalkeeper positioning
- Football: route running, coverage, block shedding, blitz reads
- Hockey: puck battles, breakouts, positioning, shot selection

For EACH player who made a meaningful decision (2–5 players), return a block in exactly this format:

=== PLAYER ===
Player: [If jersey number is clearly legible, use "#NUMBER (TEAM COLOR or NAME)". If number is unclear or not visible, use a descriptive label like "Blue Guard", "White Forward", "Red Goalkeeper" — NEVER guess a number you are not certain about.]
Role: [their specific role — e.g. Ball Handler, Help Defender, Shot Blocker, Goalkeeper, Striker]
Action: [what they did — e.g. Attempted steal, Drive to basket, Block, Defensive rotation, Off-ball cut]
Sport: [detected sport]
Decision Grade: [A+ to F]

What Happened:
[1 concise sentence — only what is visible.]

Decision Read:
[Was this smart? 1 sentence.]

Best Alternative:
[The better option available to them.]

Why It Was Better:
[Brief tactical reason.]

Other Options:
- [Option 1]
- [Option 2]

Pattern To Improve:
[One specific habit for this player.]

Practice Focus:
[One drill or rep type.]
=== END ===

Sport: ${sport || "auto-detect from frames"}
Keep each player block under 120 words.
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
