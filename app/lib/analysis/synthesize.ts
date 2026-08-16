import OpenAI from "openai";
import { buildDecisionTally } from "./parsers";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type SynthesizeInput = {
  sport?: string;
  chunkSummaries: { index: number; start: string; end: string; text: string }[];
  teamsNote?: string;
  jersey?: string;
  teamColor?: string;
};

export async function synthesizeGameReport({ sport, chunkSummaries, teamsNote, jersey, teamColor }: SynthesizeInput): Promise<string> {
  // Grade from evidence, not vibes: every decision the segments logged is
  // tallied in code first, then handed to the model as the basis for the
  // grade. Same game in, same counts out.
  const tally = buildDecisionTally(chunkSummaries.map(c => c.text));
  const evidenceBlock = tally.total > 0
    ? `\nDECISION EVIDENCE (counted in code from every segment — this is the factual basis for the grade):
Across the whole game: ${tally.good} good, ${tally.neutral} neutral, ${tally.poor} poor (${tally.total} decisions logged).
Per player: ${tally.byPlayer.slice(0, 12).map(p => `${p.player} ${p.good}g/${p.neutral}n/${p.poor}p`).join("; ")}

GRADE FROM THIS EVIDENCE: base Overall Decision Grade on these counts, not on impressions. Roughly: 70%+ good = A range; ~55-70% good = B range; ~40-55% good = C range; ~25-40% good = D range; under 25% good = F. Adjust modestly for how costly the poor decisions were. State the counts in the Game Summary so the athlete can see why they got that grade.\n`
    : "";

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
            text: `You are an elite sports coach delivering a full post-game film review to your athlete. You've just watched their entire game together. Speak directly to them — use "you" and "your." Reference actual events you observed. Never be generic.

TONE — BE DIRECT, DO NOT SUGARCOAT: say the real thing plainly, the way a good coach does in the film room. No praise sandwiches, no softening qualifiers ("just", "maybe", "a little"), no cheerleading, no motivational filler. If they played badly, say so and say why. Respectful and never insulting — but honest first. Do not invent positives that the evidence does not support.

BREVITY: Every field must be a single sentence — two at the very most. Punchy, direct hits like a coach who doesn't waste words. No filler, no windup.

Sport: ${sport || "auto-detected"}${teamContext}${uploaderContext}

Film segments:
${summaryText}

Synthesize everything into a complete Game Report in this exact format:
${evidenceBlock}
GRADING RUBRIC — grade DECISIONS across the game, not outcomes. A = consistently optimal reads; B = mostly sound with minor flaws; C = defensible but often left better reads on the table; D = frequently forced/late/poor choices; F = repeated clear mistakes that cost the team. Anchor grades to this so they stay consistent and comparable over time.

Overall Decision Grade: [A+ to F — the whole game's decision-making against the rubric, not just highlights]

Your Grade: [A+ to F — the UPLOADER's individual grade, based on THEIR player's own good/neutral/poor counts in the decision evidence above. If they do not appear in the evidence, write "N/A" — never guess a grade for a player you cannot identify.]

Did Well:
- [Short plain-language phrase naming something they actually did well this game, drawn from their good decisions in the evidence — e.g. "Attacking the rim against pressure" or "Smart shot choices against the block". No full sentences, no coaching, just the thing.]
- [Another, if there is one. 1-3 lines total. Write "Nothing stood out clearly." if the evidence doesn't support any.]

Work On:
- [Short plain-language phrase naming something to improve, drawn from their poor decisions — e.g. "Shot selection late in the clock" or "Forcing sets to a covered hitter". No full sentences.]
- [Another, if there is one. 1-3 lines total.]

Game Summary:
[One sentence (two max) to the athlete — what defined their game, referencing a specific moment.]

Period Breakdown:
[One sentence naming the single most telling moment or shift across the game — by quarter, half, or set — and what it revealed.]

Foul & Call Patterns:
[One sentence on the clearest foul/call pattern you saw and when it happened — basketball fouls, or volleyball faults like net touches, lifts, and rotation errors — or "None notable." if there wasn't one.]

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
- [#NUMBER (TEAM) | Decisions: X sharp / Y costly | Fouls: Z | Standout moment: one-line note. Take "sharp" from that player's good count and "costly" from their poor count in the decision evidence above — do not invent different numbers. Keep the literal label "Fouls:" whatever the sport — in volleyball, Z counts their called faults (net touches, lifts, rotation errors).]
- [Repeat for EVERY player you could track across the segments — aim for the main rotation on BOTH teams, typically 6–10 players, not just 2–3. Use a jersey number only if it was clearly confirmed; otherwise use the descriptive label from the segments, e.g. "White Point Guard (White)", "Blue Center (Blue)", or "Blue Setter (Blue)". A player tracked by description is still a player — include them. Only write "No players could be tracked." if the segments truly identify no one.]

Team Comparison:
Teams: [Team A name/color] vs [Team B name/color]
Score: [X–Y only if a scoreboard was clearly readable in the frames — otherwise write "Not visible"]
Winner: [team name, or "Unclear"]
- [Stat name | Team A number | Team B number — ONLY stats you directly observed across the segments, e.g. basketball: "Made baskets | 6 | 4", "Turnovers | 3 | 5", "Fouls | 2 | 4"; volleyball: "Kills | 8 | 5", "Aces | 2 | 1", "Service errors | 1 | 3". These are observed counts from the film, not full box-score totals. NEVER invent percentages or numbers you did not see. Skip any stat you can't count. If you can't compare the teams at all, write "Not enough visible data." on one line instead.]
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
