import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type AnalyzeDrillInput = {
  drill: string;        // the drill the athlete was told to do (from a report's Practice Focus)
  frames: string[];     // stills of them doing it, chronological
  sport?: string;
};

export class DrillCheckError extends Error {}

// Checks a player's own drill recording against the drill they were prescribed.
// This is the "close the loop" analysis — deliberately a single-player, close-up,
// controlled clip, which is the easiest case for the vision model (the opposite
// of wide game footage). Honest form-check depth, not biomechanics.
export async function analyzeDrill({ drill, frames, sport }: AnalyzeDrillInput): Promise<string> {
  const imageInputs = frames.map((frame) => ({
    type: "input_image" as const,
    image_url: frame,
    detail: "auto" as const,
  }));

  // Quick sanity check that the clip actually shows a person doing a drill, so
  // we don't hand back confident "feedback" on an empty gym or a random video.
  const check = await openai.responses.create({
    model: "gpt-4.1",
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: `Do these frames show a single person actively doing a sports drill or working on a skill (shooting, dribbling, footwork, passing against a wall, etc.)? Answer ONLY "VALID" or "INVALID: [brief reason]".` },
        ...imageInputs.slice(0, 3),
      ],
    }],
    temperature: 0,
  });
  const checkResult = check.output_text?.trim() ?? "";
  if (!checkResult.startsWith("VALID")) {
    const reason = checkResult.replace(/^INVALID:\s*/i, "") || "This doesn't look like someone doing a drill.";
    throw new DrillCheckError(`Can't check this drill — ${reason}. Record yourself doing the drill and try again.`);
  }

  const prompt = `You are a sharp, encouraging skills coach reviewing a young athlete's recording of a solo drill you assigned them. These frames are sequential stills of ONE person doing the drill, in order — read them as a single continuous motion, not separate photos.

THE DRILL THEY WERE TOLD TO DO:
${drill}

Sport: ${sport || "auto-detect from the frames"}

Judge ONLY their execution of THIS drill against how it's supposed to be done. Be honest and specific about what you can actually see — reps, body position, footwork, follow-through, tempo, effort. This is a form check on what's visible, not a biomechanics lab: comment on gross mechanics you can genuinely see, and never invent detail you can't (exact joint angles, etc.).

Talk directly to the athlete ("you"). Every field is ONE sentence — punchy, like a coach who gives quick, useful hits. No filler.

Avoid "left/right" unless you're certain — video can be mirrored, so prefer terms like "guide hand," "shooting hand," "front foot," "near side" that don't flip.

Return ONLY this format:

Verdict: [Yes / Mostly / No / Unclear — are they doing the drill correctly?]
Did Well: [one specific thing they did right]
Main Fix: [the single most important correction, specific and visible]
Focus Next: [one concrete cue to hold in their mind on the next rep]`;

  const response = await openai.responses.create({
    model: "gpt-4.1",
    temperature: 0.2,
    input: [{
      role: "user",
      content: [{ type: "input_text", text: prompt }, ...imageInputs],
    }],
  });

  return response.output_text;
}
