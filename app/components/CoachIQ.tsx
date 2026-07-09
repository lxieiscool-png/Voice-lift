"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, DrillDay, PracticePlan, Profile, Review } from "../lib/types";
import { sportIcon, sportSuggestions } from "../lib/shared";

// ─── Plan Parser ──────────────────────────────────────────────────────────────

function parsePlan(rawText: string): PracticePlan {
  const text = rawText.replace(/\*\*/g, "").replace(/^#+\s*/gm, "");
  const weekFocus = text.match(/Week Focus:\s*(.+)/i)?.[1]?.trim() ?? "";
  const coachNote = text.match(/Coach'?s? Note:\s*([\s\S]*?)(?=\nDay \d+:|\n[A-Z]|$)/i)?.[1]?.trim() ?? "";

  const dayBlocks = text.split(/\nDay \d+:/i).slice(1);
  const days: DrillDay[] = dayBlocks.map((block, i) => {
    const focus = block.match(/^.*?Focus:\s*(.+)/m)?.[1]?.trim() ?? `Session ${i + 1}`;
    const drillBlocks = block.split(/Drill \d+:/i).slice(1);
    const drills = drillBlocks.map((db) => ({
      name: db.match(/Name:\s*(.+)/i)?.[1]?.trim() ?? "Drill",
      description: db.match(/How:\s*([\s\S]*?)(?=\n\s*Reps:|$)/i)?.[1]?.trim() ?? "",
      reps: db.match(/Reps:\s*(.+)/i)?.[1]?.trim() ?? "",
      why: db.match(/Why:\s*(.+)/i)?.[1]?.trim() ?? "",
    }));
    return { day: `Day ${i + 1}`, focus, drills };
  });

  return { weekFocus, coachNote, days };
}

// ─── Chat bubble ──────────────────────────────────────────────────────────────

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isCoach = msg.role === "coach";
  return (
    <div className={`flex gap-3 ${isCoach ? "" : "flex-row-reverse"}`}>
      <div className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${isCoach ? "bg-white text-black" : "bg-zinc-700 text-white"}`}>
        {isCoach ? "C" : "Y"}
      </div>
      <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${isCoach ? "bg-zinc-800 text-gray-200 rounded-tl-sm" : "bg-white text-black rounded-tr-sm"}`}>
        {msg.content}
      </div>
    </div>
  );
}

// ─── Practice Plan Card ───────────────────────────────────────────────────────

function PlanCard({ plan }: { plan: PracticePlan }) {
  const [openDay, setOpenDay] = useState<number | null>(0);

  return (
    <div className="space-y-4">
      {plan.weekFocus && (
        <div className="rounded-2xl border border-zinc-700 bg-zinc-800 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">🗓️ This Week's Focus</p>
          <p className="font-bold text-white">{plan.weekFocus}</p>
        </div>
      )}

      {plan.coachNote && (
        <div className="rounded-2xl border border-zinc-800 bg-black px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">💬 From Your Coach</p>
          <p className="text-sm text-white leading-relaxed">{plan.coachNote}</p>
        </div>
      )}

      {plan.days.map((day, i) => (
        <div key={i} className="rounded-2xl border border-zinc-800 bg-black overflow-hidden">
          <button
            onClick={() => setOpenDay(openDay === i ? null : i)}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <div>
              <p className="font-bold text-white">{day.day}</p>
              <p className="text-xs text-zinc-400">{day.focus}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">{day.drills.length} drill{day.drills.length !== 1 ? "s" : ""}</span>
              <span className="text-zinc-500 text-xs">{openDay === i ? "▲" : "▼"}</span>
            </div>
          </button>

          {openDay === i && (
            <div className="border-t border-zinc-800 p-4 space-y-3">
              {day.drills.map((drill, j) => (
                <div key={j} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="font-bold text-white">{drill.name}</p>
                    {drill.reps && (
                      <span className="shrink-0 rounded-lg bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">{drill.reps}</span>
                    )}
                  </div>
                  {drill.description && <p className="text-sm text-gray-300 leading-relaxed mb-2">{drill.description}</p>}
                  {drill.why && (
                    <p className="text-xs text-zinc-500">
                      <span className="text-zinc-400 font-semibold">Why: </span>{drill.why}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── CoachIQ Main ─────────────────────────────────────────────────────────────

export default function CoachIQ({ profile, reviews }: { profile: Profile; reviews: Review[] }) {
  const [tab, setTab] = useState<"chat" | "plan">("chat");

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Plan state
  const [position, setPosition] = useState("");
  const [level, setLevel] = useState("Intermediate");
  const [daysPerWeek, setDaysPerWeek] = useState("3");
  const [weaknesses, setWeaknesses] = useState("");
  const [planLoading, setPlanLoading] = useState(false);
  const [plan, setPlan] = useState<PracticePlan | null>(null);
  const [planError, setPlanError] = useState("");

  // Pull recent patterns from DecisionIQ history
  const recentPatterns = reviews
    .flatMap(r => r.decisions?.map(d => d.patternToImprove).filter(Boolean) ?? [])
    .slice(0, 5);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatLoading]);

  // Greeting on first load
  useEffect(() => {
    const greeting = profile.name
      ? `Hey ${profile.name.split(" ")[0]}! I'm CoachIQ — your personal coach. Ask me anything about ${profile.sport || "your sport"}: technique, strategy, drills, mindset — whatever you need. I'm here to help.`
      : "Hey! I'm CoachIQ — your personal coach. Ask me anything: drills, strategy, technique, mindset. Set up your profile to get more personalized coaching.";
    setMessages([{ role: "coach", content: greeting }]);
  }, []);

  async function sendMessage() {
    if (!input.trim() || chatLoading) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, profile, recentPatterns }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: "coach", content: data.reply ?? "No response." }]);
    } catch {
      setMessages(prev => [...prev, { role: "coach", content: "Something went wrong. Try again." }]);
    }
    setChatLoading(false);
  }

  async function generatePlan() {
    setPlanLoading(true);
    setPlan(null);
    setPlanError("");
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sport: profile.sport,
          position,
          level,
          daysPerWeek,
          weaknesses: weaknesses || recentPatterns.join(", "),
          profile,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.plan) throw new Error("No plan returned.");
      const parsed = parsePlan(data.plan);
      if (parsed.days.length === 0) throw new Error("Couldn't build a plan from that. Try again.");
      setPlan(parsed);
    } catch (err) {
      console.error(err);
      setPlanError(err instanceof Error ? err.message : "Something went wrong building your plan.");
    }
    setPlanLoading(false);
  }

  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <div className="flex rounded-2xl border border-zinc-800 bg-zinc-900 p-1">
        {(["chat", "plan"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition-colors ${tab === t ? "bg-white text-black" : "text-zinc-400 hover:text-white"}`}
          >
            {t === "chat" ? "💬 Ask Coach" : "📋 Build My Plan"}
          </button>
        ))}
      </div>

      {/* Chat tab */}
      {tab === "chat" && (
        <div className="rounded-3xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 overflow-hidden flex flex-col" style={{ height: "min(520px, calc(100dvh - 220px))" }}>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {messages.map((msg, i) => <ChatBubble key={i} msg={msg} />)}
            {chatLoading && (
              <div className="flex gap-3">
                <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded-full bg-white text-black text-sm font-bold">C</div>
                <div className="rounded-2xl rounded-tl-sm bg-zinc-800 px-4 py-3">
                  <div className="flex gap-1 items-center h-5">
                    {[0, 1, 2].map(i => (
                      <div key={i} className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Suggested questions */}
          {messages.length === 1 && (
            <div className="px-5 pb-3 flex flex-wrap gap-2">
              {[
                ...(recentPatterns[0] ? [`Help me fix: ${recentPatterns[0]}`] : []),
                ...sportSuggestions(profile.sport),
                "How do I stay calm under pressure?",
              ].slice(0, 3).map((q, i) => (
                <button
                  key={i}
                  onClick={() => { setInput(q); }}
                  className="rounded-xl border border-zinc-700 bg-zinc-800/50 px-3.5 py-2 text-xs font-medium text-zinc-300 hover:border-zinc-400 hover:bg-zinc-800 hover:text-white transition-all text-left"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="border-t border-zinc-800 p-4 flex gap-3">
            <input
              className="flex-1 rounded-xl border border-zinc-700 bg-black px-4 py-3 text-sm placeholder-zinc-500 focus:outline-none focus:border-white transition-colors"
              placeholder="Ask your coach anything…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
            />
            <button
              onClick={sendMessage}
              disabled={chatLoading || !input.trim()}
              className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-black disabled:opacity-40 hover:bg-gray-100 transition-colors active:scale-95"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* Plan builder tab */}
      {tab === "plan" && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Form */}
          <div className="rounded-3xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 p-5 sm:p-6">
            <h3 className="mb-4 text-xl font-bold">Build My Plan</h3>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-400">Sport</label>
                <input
                  className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-sm placeholder-zinc-500 focus:outline-none focus:border-white transition-colors"
                  placeholder={profile.sport || "Basketball, Soccer, Water Polo…"}
                  value={profile.sport}
                  readOnly
                />
                {!profile.sport && <p className="mt-1 text-xs text-zinc-500">Set your sport in your profile ↑</p>}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-400">Position</label>
                <input
                  className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-sm placeholder-zinc-500 focus:outline-none focus:border-white transition-colors"
                  placeholder="e.g. Point Guard, Striker, Goalkeeper…"
                  value={position}
                  onChange={e => setPosition(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-400">Level</label>
                  <select
                    className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-sm text-white focus:outline-none focus:border-white transition-colors"
                    value={level}
                    onChange={e => setLevel(e.target.value)}
                  >
                    <option>Beginner</option>
                    <option>Intermediate</option>
                    <option>Advanced</option>
                    <option>Elite</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-400">Days/Week</label>
                  <select
                    className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-sm text-white focus:outline-none focus:border-white transition-colors"
                    value={daysPerWeek}
                    onChange={e => setDaysPerWeek(e.target.value)}
                  >
                    {["2","3","4","5","6"].map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Weaknesses to focus on
                </label>
                <textarea
                  className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-sm placeholder-zinc-500 focus:outline-none focus:border-white transition-colors resize-none"
                  placeholder={recentPatterns.length ? `From your film: ${recentPatterns[0]}` : "e.g. dribbling under pressure, shot selection, defensive positioning…"}
                  rows={3}
                  value={weaknesses}
                  onChange={e => setWeaknesses(e.target.value)}
                />
                {recentPatterns.length > 0 && !weaknesses && (
                  <button
                    onClick={() => setWeaknesses(recentPatterns.join(", "))}
                    className="mt-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    + Use patterns from your film analysis
                  </button>
                )}
              </div>

              <button
                onClick={generatePlan}
                disabled={planLoading}
                className="w-full rounded-2xl bg-white py-4 text-base font-bold text-black disabled:opacity-40 hover:bg-gray-100 transition-colors active:scale-95"
              >
                {planLoading ? "Building your plan…" : `Build My ${daysPerWeek}-Day Plan`}
              </button>
            </div>
          </div>

          {/* Plan output */}
          <div className="rounded-3xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 p-5 sm:p-6">
            <h3 className="mb-4 text-xl font-bold">Your Plan</h3>

            {planLoading && (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl border border-zinc-800 bg-black" />)}
                <p className="text-center text-sm text-zinc-500 animate-pulse">Building your personalized plan…</p>
              </div>
            )}

            {!planLoading && planError && (
              <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-red-900 bg-red-950/20 px-6 text-center">
                <span className="text-3xl">⚠️</span>
                <p className="text-sm text-red-300">{planError}</p>
                <button onClick={generatePlan}
                  className="rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-zinc-100 transition-colors">
                  Try again
                </button>
              </div>
            )}

            {!planLoading && !plan && !planError && (
              <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-zinc-800 bg-black">
                <span className="text-5xl">📋</span>
                <p className="text-center text-sm text-zinc-500 px-4">
                  Fill in your details and click Build My Plan
                </p>
                {recentPatterns.length > 0 && (
                  <p className="text-center text-xs text-zinc-600 px-6">
                    We found {recentPatterns.length} pattern{recentPatterns.length !== 1 ? "s" : ""} from your film analysis to target
                  </p>
                )}
              </div>
            )}

            {!planLoading && plan && <PlanCard plan={plan} />}
          </div>
        </div>
      )}
    </div>
  );
}
