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

BREVITY: Every field must be a single sentence — two at the very most. Punchy, direct hits like a coach who doesn't waste words. No filler, no windup.

Sport: ${sport || "auto-detected"}${teamContext}${uploaderContext}

Film segments:
${summaryText}

Synthesize everything into a complete Game Report in this exact format:

GRADING RUBRIC — grade DECISIONS across the game, not outcomes. A = consistently optimal reads; B = mostly sound with minor flaws; C = defensible but often left better reads on the table; D = frequently forced/late/poor choices; F = repeated clear mistakes that cost the team. Anchor grades to this so they stay consistent and comparable over time.

Overall Decision Grade: [A+ to F — the whole game's decision-making against the rubric, not just highlights]

Your Grade: [A+ to F — the UPLOADER's individual grade based only on the decisions of ${jersey || teamColor ? "their player (see THE UPLOADER above)" : "the primary athlete"} across the segments, against the rubric. If you could not identify them in the film, write "N/A".]

Game Summary:
[One sentence (two max) to the athlete — what defined their game, referencing a specific moment.]

Period Breakdown:
[One sentence naming the single most telling moment or shift across the game and what it revealed.]

Foul & Call Patterns:
[One sentence on the clearest foul/call pattern you saw and when it happened — or "None notable." if there wasn't one.]

Decision Trends:
[One sentence on how their decision-making shifted during the game and why it matters.]

Top 3 Strengths:
- [Strength 1 — one short phrase or sentence]
- [Strength 2 — same]
- [Strength 3 — same]

Top 3 Areas To Improve:
- [Area 1 — one short phrase or sentence]
- [Area 2 — same]
- [Area 3 — same]

Game-Level Practice Focus:
[One sentence: name one solo, no-equipment drill with exact reps/duration and the one cue — tied to their biggest area to improve.]

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
