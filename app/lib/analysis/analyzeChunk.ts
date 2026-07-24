import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Clip mode does one deep, single-player-focused coaching writeup per video —
// worth paying for gpt-5's reasoning. Game-mode segments are mechanical
// extraction (who's visible, what happened) repeated many times per game;
// reasoning effort there is pure latency/cost with no quality payoff, so
// those go straight to gpt-4.1. gpt-5 is a reasoning model — it rejects
// `temperature`, so params differ per model.
async function createVisionResponse(input: any, useReasoning: boolean) {
  if (!useReasoning) {
    return await openai.responses.create({ model: "gpt-4.1", temperature: 0, input });
  }
  try {
    return await openai.responses.create({ model: "gpt-5", reasoning: { effort: "low" }, input } as any);
  } catch (e) {
    console.warn("gpt-5 unavailable, falling back to gpt-4.1:", (e as any)?.message);
    return await openai.responses.create({ model: "gpt-4.1", temperature: 0, input });
  }
}

export type AnalyzeChunkInput = {
  sport?: string;
  frames: string[];
  mode: "clip" | "game";
  chunkIndex?: number;
  chunkStart?: string;
  chunkEnd?: string;
  jersey?: string;
  teamColor?: string;
  teamsNote?: string;
  lenient?: boolean;
};

export class SportsCheckError extends Error {}

export async function analyzeChunk({
  sport, frames, mode, chunkIndex = 0, chunkStart = "", chunkEnd = "", jersey, teamColor, teamsNote, lenient,
}: AnalyzeChunkInput): Promise<string> {
  const honestyBlock = lenient
    ? `BEST-EFFORT MODE: The uploader asked for analysis even though the footage may be unclear. Give them your best read of what most likely happened based on what IS visible — positioning, spacing, body language. Start any uncertain call with "Low confidence:" so they know. Still never invent jersey numbers or specific events you cannot see at all.`
    : `HONESTY OVERRIDE: If the frames are too blurry, too sparse, or too ambiguous to actually tell what happened, DO NOT invent a play. It is far better to grade fewer players well than to fabricate. If you genuinely cannot make out a real decision, output a single line "UNCLEAR: [what you can and can't see]" instead of a player block. Never manufacture a play that isn't clearly supported by the frames.`;

  const teamContext = teamsNote?.trim()
    ? `\nTEAM CONTEXT (from the uploader — trust this over appearances): ${teamsNote.trim()}\nThere are exactly TWO teams in this game. Even if one team wears mixed or different-looking jerseys, assign every player to one of these two teams based on this description and which basket they attack. Never invent a third team.\n`
    : "";

  const imageInputs = frames.map((frame: string) => ({
    type: "input_image" as const,
    image_url: frame,
    detail: "auto" as const,
  }));

  const isGameMode = mode === "game";

  // Static instructions come first and stay byte-identical across every
  // segment call for a game (called many times per game, run concurrently)
  // — this maximizes the prefix OpenAI's automatic prompt caching can match,
  // cutting cost and latency on every call after the first. Segment-specific
  // context (which changes every call) goes at the very end instead of up top.
  const prompt = isGameMode
    ? `You are an elite sports analyst reviewing game film with a coach. Be precise — only report what you can clearly see. Never guess or fabricate details.

Carefully study every frame before responding. Only track athletes actively competing — ignore referees, officials, coaches, spectators, and bench players not involved in the play.

Return ONLY this format — no extra commentary:

Period/Quarter: [e.g. "2nd Quarter" or "unclear"]
Game Clock: [e.g. "4:32" or "unclear"]
Score: [e.g. "Lakers 54 – Celtics 48" or "unclear"]

Key Events:
- [Each notable play, foul, or score. Include jersey number and team only if clearly readable. Use "Blue #12" style if partially visible. "None detected" if nothing notable.]

Player Tracking:
- [One line for EVERY active player visible in this segment, from BOTH teams — in basketball that's usually 8–10 lines, not 2–3. Look HARD for jersey numbers on chests and backs in every frame — a number readable in even one clear frame counts: "Red #11 Guard". Use a descriptive label like "White Point Guard" only when the number is genuinely unreadable in every frame. Never guess or partially read a number, but don't omit one you can actually read.]

Stat Events:
- [One line per COUNTABLE stat event you can clearly see the OUTCOME of in these frames. Format EXACTLY: "TEAM #NUM | event". Team+number must match the Player Tracking labels (e.g. "Blue #12"); if the number is unreadable, use the color + role like "Blue Guard". The event MUST be one of exactly these tokens: made_2, made_3, missed_2, missed_3, made_ft, missed_ft, rebound, assist, steal, turnover, block, foul. Rules: only log an event when the outcome is genuinely visible across the frames — never guess make vs miss; if you can see a shot went up but not whether it fell, DO NOT log it. Do not infer events between frames you cannot see. One line per event; the same event may involve two lines (e.g. a steal AND the resulting turnover). Write "None" if nothing countable is clearly visible.]

Decision Quality:
[2–3 sentences directly to the athlete. Be honest and specific about what you saw — not generic. Reference actual events from the frames.]

Tactical Pattern:
[One concrete tactical pattern visible this segment — e.g. "The defense consistently sagged off the corner three, leaving the shooter open twice."]

--- SEGMENT CONTEXT ---
Segment ${chunkIndex + 1} covers ${chunkStart}–${chunkEnd}.
Sport: ${sport || "auto-detect from frames"}${teamContext}
`
    : `You are an elite sports coach doing a film session with your athlete. You are direct, specific, and honest. You only describe what you can actually see in the frames — never fabricate or assume.

THE FRAMES: These images are sequential stills pulled from ONE short clip, roughly one second apart, in chronological order. Read them as a single continuous play unfolding over time — track how players and the ball move from the first frame to the last. Do NOT treat them as separate unrelated photos.

${honestyBlock}

Study the frames carefully. Identify EVERY player making a notable decision — offense AND defense, from BOTH teams. Look hard at every player visible across the frames, not just whoever is holding the ball. Do not stop at 2 or 3 — if 6, 8, or more players are doing something worth grading, grade all of them. Only skip a player if they are genuinely not doing anything decision-relevant in this clip.

ONLY grade athletes who are actively playing in the game. Completely ignore and do NOT grade: referees, officials, coaches, spectators, people in the stands, people on the bench who are not in the play, ball boys, or anyone not actively competing on the field/court.

${jersey || teamColor ? `IMPORTANT: The athlete who uploaded this footage is ${teamColor ? `on the ${teamColor} team` : ""}${jersey ? ` wearing jersey #${jersey}` : ""}. You MUST include this specific player in your analysis — they are the primary subject. Make sure their player block appears first in your output.` : ""}

Sport: ${sport || "auto-detect from frames"}${teamContext}

Use exact sport terminology. Reel specializes in basketball and volleyball — for these two sports, go DEEP:

BASKETBALL (specialty — grade with real coaching depth):
- Offense: shot selection relative to spacing and defender position, drive-vs-kick reads, pick-and-roll decisions (reject, snake, pocket pass, pull-up), pace on the catch, attacking closeouts, cutting off the ball, offensive rebounding position
- Defense: help-side positioning, closeout technique (high hands vs. short), screen navigation (over/under/switch), gap discipline, transition matchups, boxing out
- Read the whole floor: if a shooter was open weakside and the ball-handler missed them, say so specifically

VOLLEYBALL (specialty — grade with real coaching depth):
- Serve receive: platform angle, first-contact quality, seam communication
- Setting: choice vs. block positioning (who was the hot hand, where was the double), tempo selection, dump opportunities
- Attacking: shot selection vs. the block (line, cross, tool, tip), approach timing, hitting off-speed when out of system
- Defense/blocking: block positioning vs. hitter tendencies, defensive base positions, reading the setter's hands, coverage behind the block

Other sports (soccer, football, hockey, lacrosse, baseball, etc.): still analyze them with proper positional terminology, but be honest about lower confidence — fast-moving or wide-shot sports are harder to grade from frames.

For EACH player, output this block EXACTLY:

=== PLAYER ===
Player: [Look HARD for jersey numbers — zoom your attention onto each player's chest and back in every frame; a number readable in even ONE clear frame counts. Format: "White #23 Point Guard". Only fall back to a descriptive label like "White Point Guard" if the number is genuinely unreadable in every frame. Never guess or partially read a number — a wrong number is worse than none — but do not omit a number you can actually read.]
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

  // Pre-check: confirm this is real sports footage before full analysis.
  // For game mode this only needs to run once (segment 0) — every later segment
  // is frames from the same already-validated video, so skipping it saves a
  // redundant OpenAI call per segment.
  const needsPrecheck = !isGameMode || chunkIndex === 0;
  if (needsPrecheck) {
    const checkResponse = await openai.responses.create({
      model: "gpt-4.1",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Look at these frames. Is this real sports footage showing actual athletes competing in an organized sport (basketball, soccer, football, hockey, baseball, volleyball, lacrosse, tennis, wrestling, etc.)?

Answer ONLY with one of:
VALID: [sport name]
INVALID: [brief reason — e.g. "video game footage", "not a sport", "animated content", "unclear/no athletes visible"]

Do not add any other text.`,
            },
            ...imageInputs.slice(0, 3),
          ],
        },
      ],
      temperature: 0,
    });

    const checkResult = checkResponse.output_text?.trim() ?? "";
    if (!checkResult.startsWith("VALID")) {
      const reason = checkResult.replace(/^INVALID:\s*/i, "") || "This doesn't look like sports footage.";
      throw new SportsCheckError(`Can't analyze this video — ${reason}. Please upload a real sports clip.`);
    }
  }

  const response = await createVisionResponse([
    {
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        ...imageInputs,
      ],
    },
  ], !isGameMode);

  return response.output_text;
}
