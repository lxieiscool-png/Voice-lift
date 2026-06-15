import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  try {
    const { sport, frames, mode, chunkIndex, chunkStart, chunkEnd, jersey, teamColor } = await req.json();

    const imageInputs = frames.map((frame: string) => ({
      type: "input_image",
      image_url: frame,
    }));

    const isGameMode = mode === "game";

    const prompt = isGameMode
      ? `You are an elite sports analyst reviewing game film with a coach. Be precise — only report what you can clearly see. Never guess or fabricate details.

Segment ${chunkIndex + 1} covers ${chunkStart}–${chunkEnd}.
Sport: ${sport || "auto-detect from frames"}

Carefully study every frame before responding. Only track athletes actively competing — ignore referees, officials, coaches, spectators, and bench players not involved in the play.

Return ONLY this format — no extra commentary:

Period/Quarter: [e.g. "2nd Quarter" or "unclear"]
Game Clock: [e.g. "4:32" or "unclear"]
Score: [e.g. "Lakers 54 – Celtics 48" or "unclear"]

Key Events:
- [Each notable play, foul, or score. Include jersey number and team only if clearly readable. Use "Blue #12" style if partially visible. "None detected" if nothing notable.]

Player Tracking:
- [One line per active player. Default to descriptive labels: "White Point Guard", "Blue Center", "Red #11" — only include a jersey number if it is completely unambiguous and fully visible in multiple frames. If there is ANY uncertainty about a number, omit it entirely. Wrong numbers destroy trust. Never guess, infer, or partially read a jersey number.]

Decision Quality:
[2–3 sentences directly to the athlete. Be honest and specific about what you saw — not generic. Reference actual events from the frames.]

Tactical Pattern:
[One concrete tactical pattern visible this segment — e.g. "The defense consistently sagged off the corner three, leaving the shooter open twice."]
`
      : `You are an elite sports coach doing a film session with your athlete. You are direct, specific, and honest. You only describe what you can actually see in the frames — never fabricate or assume.

Study the frames carefully. Identify every PLAYER making a notable decision — offense AND defense, 2 to 5 players total.

ONLY grade athletes who are actively playing in the game. Completely ignore and do NOT grade: referees, officials, coaches, spectators, people in the stands, people on the bench who are not in the play, ball boys, or anyone not actively competing on the field/court.

${jersey || teamColor ? `IMPORTANT: The athlete who uploaded this footage is ${teamColor ? `on the ${teamColor} team` : ""}${jersey ? ` wearing jersey #${jersey}` : ""}. You MUST include this specific player in your analysis — they are the primary subject. Make sure their player block appears first in your output.` : ""}

Sport: ${sport || "auto-detect from frames"}

Use exact sport terminology:
- Basketball: pick-and-roll reads, help rotations, closeouts, drive-kick decisions, screen navigation, post footwork, transition defense
- Soccer: press triggers, third-man combinations, defensive shape, wide overloads, switch of play, goalkeeper distribution
- Football: route stems, leverage, gap assignments, blitz pickup, coverage keys, run fits
- Hockey: gap control, puck retrieval angles, D-zone coverage, cycle reads, shot selection
- Lacrosse, volleyball, baseball, etc. — use proper positional terminology for the sport

For EACH player, output this block EXACTLY:

=== PLAYER ===
Player: [STRICT RULE — use a descriptive label by default: "White Point Guard", "Red Striker", "Blue #5" only if the number is crystal clear and fully readable in MULTIPLE frames without any blur or obstruction. If you have ANY doubt about a jersey number, DO NOT include it. A wrong jersey number is a critical error. It is always better to say "White Forward" than to guess "#23". Never infer, estimate, or partially read a number.]
Role: [Specific role in this play — not just "defender", but "Help-side defender", "Ball-screen navigator", "Free safety", etc.]
Action: [Exactly what they did — "Drove baseline left, drew contact, missed the finish", "Dropped into zone coverage late, gave up the crossing route"]
Sport: [sport name]
Decision Grade: [A+ / A / A- / B+ / B / B- / C+ / C / C- / D / F]

What Happened:
[One specific sentence describing what occurred. Reference what you see — not generic.]

Decision Read:
[Talk directly to this player as their coach. Did they read it correctly? Were they early, late, hesitant? E.g. "You saw the weakside open but your eyes didn't get there until the defender recovered — that half-second hesitation is the difference."]

Best Alternative:
[Coach them precisely: "The read here was to..." Include why the timing mattered.]

Why It Was Better:
[One tactical sentence — the "why" a smart coach gives, not just "it would have worked better".]

Other Options:
- [Realistic option 1 with brief outcome]
- [Realistic option 2 with brief outcome]

Pattern To Improve:
[One specific habit. Frame it as a pattern, not a one-off mistake: "The pattern here is..." or "What this shows is a tendency to..."]

Practice Focus:
[One drill they can do completely ALONE with zero equipment — no cones, no teammates, no gym. Just their body, open space, and maybe a ball. Name the drill, exact reps or duration, and the one mental cue to focus on while doing it. Make it directly fix the pattern above.]
=== END ===
`;

    const response = await openai.responses.create({
      model: "gpt-4.1",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            ...imageInputs,
          ],
        },
      ],
      temperature: 0.3,
    });

    return Response.json({ feedback: response.output_text });
  } catch (error: any) {
    console.error("OPENAI ERROR:", error);
    return Response.json({ error: error?.message || "Analysis failed." }, { status: 500 });
  }
}
