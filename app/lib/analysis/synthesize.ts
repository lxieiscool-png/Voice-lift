import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type SynthesizeInput = {
  sport?: string;
  chunkSummaries: { index: number; start: string; end: string; text: string }[];
  teamsNote?: string;
  jersey?: string;
  teamColor?: string;
};

export async function synthesizeGameReport({ sport, chunkSummaries, teamsNote, jersey, teamColor }: SynthesizeInput): Promise<string> {
  const uploaderContext = jersey || teamColor
    ? `\nTHE UPLOADER: The athlete reading this report is ${teamColor ? `on the ${teamColor} team` : ""}${jersey ? ` wearing #${jersey}` : ""}. Speak to THEM about THEIR game.\n`
    : "";

  const teamContext = teamsNote?.trim()
    ? `\nTEAM CONTEXT (from the uploader — trust this over jersey appearances): ${teamsNote.trim()}\nThere are exactly TWO teams. Group every player into one of these two teams in Player Stats and Team Comparison, even if segments described mixed jersey colors. Never list a third team.\n`
    : "";

  const summaryText = chunkSummaries
    .map((s) => `--- Segment ${s.index + 1} (${s.start}–${s.end}) ---\n${s.text}`)
    .join("\n\n");

  const response = await openai.responses.create({
    model: "gpt-4.1",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `You are an elite sports coach delivering a full post-game film review to your athlete. You've just watched their entire game together. Speak directly to them — use "you" and "your." Be honest, specific, and growth-focused. Reference actual events and patterns you observed. Never be generic.

Sport: ${sport || "auto-detected"}${teamContext}${uploaderContext}

Film segments:
${summaryText}

Synthesize everything into a complete Game Report in this exact format:

Overall Decision Grade: [A+ to F — based on the full game, not just highlights]

Your Grade: [A+ to F — the UPLOADER's individual grade based only on the decisions of ${jersey || teamColor ? "their player (see THE UPLOADER above)" : "the primary athlete"} across the segments. If you could not identify them in the film, write "N/A".]

Game Summary:
[3–4 sentences speaking directly to the athlete. Reference specific moments from the film. What defined their game? What was the story arc? Be honest but constructive.]

Period Breakdown:
[Walk through the game period by period or early/mid/late. For each, name 1–2 specific moments and what they revealed about the athlete's decision-making and energy.]

Foul & Call Patterns:
[Be specific. What types of fouls? When in the game did they occur? Was there a pattern — fouling when tired, reaching on defense, losing positioning? Coach them on it.]

Decision Trends:
[How did their decision-making evolve during the game? Did they start slow and find their rhythm? Did they tighten up under pressure? Get specific about the shift you noticed and why it matters.]

Top 3 Strengths:
- [Strength 1 — name a specific moment or pattern that showed this, then explain why it's valuable]
- [Strength 2 — same format]
- [Strength 3 — same format]

Top 3 Areas To Improve:
- [Area 1 — specific pattern you saw, why it's costing them, what to do differently]
- [Area 2 — same format]
- [Area 3 — same format]

Game-Level Practice Focus:
[One solo drill they can do completely alone with no equipment. Name it, give exact reps/duration, and connect it directly to the most important area they need to improve from this game. Include the one mental cue to focus on.]

Player Stats:
- [#NUMBER (TEAM) | Decisions: X sharp / Y costly | Fouls: Z | Standout moment: one-line note]
- [Repeat for EVERY player you could track across the segments — aim for the main rotation on BOTH teams, typically 6–10 players, not just 2–3. Use a jersey number only if it was clearly confirmed; otherwise use the descriptive label from the segments, e.g. "White Point Guard (White)" or "Blue Center (Blue)". A player tracked by description is still a player — include them. Only write "No players could be tracked." if the segments truly identify no one.]

Team Comparison:
Teams: [Team A name/color] vs [Team B name/color]
Score: [X–Y only if a scoreboard was clearly readable in the frames — otherwise write "Not visible"]
Winner: [team name, or "Unclear"]
- [Stat name | Team A number | Team B number — ONLY stats you directly observed across the segments, e.g. "Made baskets | 6 | 4", "Turnovers | 3 | 5", "Fouls | 2 | 4". These are observed counts from the film, not full box-score totals. NEVER invent percentages or numbers you did not see. Skip any stat you can't count. If you can't compare the teams at all, write "Not enough visible data." on one line instead.]
Why: [2 sentences on what decided the game between these teams, based on what you saw.]
`,
          },
        ],
      },
    ],
    temperature: 0.3,
  });

  return response.output_text;
}
