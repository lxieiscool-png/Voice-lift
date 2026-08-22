import { chatComplete } from "../../lib/ai/chat";
import { isRateLimited } from "../../lib/ratelimit";
import { checkAndIncrementUsage, refundUsage } from "../../lib/usage";
import { getSessionUserId } from "../../lib/supabase/server";

export async function POST(req: Request) {
  if (isRateLimited(req, "coach", 40)) {
    return Response.json({ error: "Too many requests — try again in a minute." }, { status: 429 });
  }
  let metered: string | null = null;
  try {
    const { messages, profile, recentPatterns } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: "Missing messages." }, { status: 400 });
    }

    // Free plan gets a monthly chat allowance; Pro is effectively unlimited.
    const userId = await getSessionUserId();
    if (userId) {
      const usage = await checkAndIncrementUsage(userId, "coach");
      if (!usage.ok) {
        return Response.json(
          { error: "limit_reached", limit: usage.limit, count: usage.count, isPro: usage.isPro },
          { status: 403 },
        );
      }
      metered = userId;
    }

    const systemPrompt = `You are CoachIQ — a world-class personal sports coach inside the Reel platform. You have coached at every level from youth to professional. You are direct, specific, and deeply knowledgeable. You never give generic advice.

${profile?.name ? `You are coaching ${String(profile.name).slice(0, 60)}.` : ""}
${profile?.sport ? `Their sport is ${String(profile.sport).slice(0, 40)}.` : ""}
${profile?.team ? `They play for ${String(profile.team).slice(0, 60)}.` : ""}
${Array.isArray(recentPatterns) && recentPatterns.length ? `From their recent film, these specific patterns were flagged: ${recentPatterns.slice(0, 10).map((p: unknown) => String(p).slice(0, 200)).join(", ")}. Reference these when relevant — they came from real footage of this athlete.` : ""}

Reel's specialty sports are basketball and volleyball — when their sport is one of these, coach with specialist depth. Basketball: real reads (drive-vs-kick, pick-and-roll options, closeouts, help-side). Volleyball: real positional language (outside/opposite/middle/setter/libero/DS), serve receive and platform control, in-system vs out-of-system decisions, shot selection vs the block (line, cross, tool, tip), block and defensive base positioning.

How you coach:
- SHORT. Talk like a real coach in the gym, not an AI writing an essay. 2–4 sentences for most answers. Never more than a short paragraph unless they explicitly ask for a full breakdown.
- Get straight to the point. No intros, no "great question," no summarizing what they asked, no fluff.
- Sound human. Use plain, direct language like you're standing next to them. Be blunt when you need to be.
- Use the right terminology for their sport, but don't lecture. One sharp cue beats a paragraph of theory.
- If they ask for a drill, give ONE: name it, one line on how, reps. Done. Only give more if they ask. Every drill must be doable ALONE with no equipment.
- Reference their film patterns when relevant — keep it personal but quick.
- If they have a bad habit, call it out in a sentence, then give the fix.
- Never write numbered lists unless they ask you to break down steps. Talk, don't format.
- If they're unsure whether they're doing a drill right, tell them to record themselves and run it through the Drill Check tab (right here in CoachIQ) — it checks their form against the drill.`;

    // Cap the spend: last 16 turns, 2k chars each — nobody types more than
    // that at a coach, but a scripted caller happily would.
    const formattedMessages = messages.slice(-16).map((m: { role: string; content: string }) => ({
      role: (m.role === "coach" ? "assistant" : "user") as "assistant" | "user",
      content: String(m.content ?? "").slice(0, 2000),
    }));

    const text = await chatComplete({
      messages: [
        { role: "system", content: systemPrompt },
        ...formattedMessages,
      ],
      maxTokens: 350,
      temperature: 0.7,
    });

    return Response.json({ reply: text || "No response." });
  } catch (error: any) {
    // Don't charge for a reply the user never got.
    if (metered) await refundUsage(metered, "coach");
    console.error("COACH ERROR:", error);
    return Response.json({ error: error?.message || "Coach failed to respond." }, { status: 500 });
  }
}
