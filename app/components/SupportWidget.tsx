"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircleQuestion, X, Send, Loader2 } from "lucide-react";

type Msg = { role: "bot" | "user"; content: string };

const GREETING: Msg = {
  role: "bot",
  content: "Hey! I'm Reel's help assistant. Ask me anything about using the app — uploading film, drills, plans, teams. What do you need?",
};

export default function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading, open]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/support", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json().catch(() => ({}));
      const reply = data.reply || (res.status === 429
        ? "I'm getting a lot of questions right now — give it a moment and try again."
        : "Sorry, I couldn't answer that. For account or billing help, email support@getreel.org.");
      setMessages(m => [...m, { role: "bot", content: reply }]);
    } catch {
      setMessages(m => [...m, { role: "bot", content: "Connection issue — try again, or email support@getreel.org." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Get help"
          className="fixed bottom-5 right-5 z-[80] flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-black/20 hover:opacity-90 transition-opacity"
        >
          <MessageCircleQuestion className="h-6 w-6" />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-[80] flex w-[calc(100vw-2.5rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
          style={{ height: "min(560px, calc(100dvh - 3rem))" }}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <MessageCircleQuestion className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-bold text-foreground">Help</p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close help" className="text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${m.role === "user" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm"}`}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2.5">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-border p-3">
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") send(); }}
                placeholder="Ask a question…"
                className="flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-ring"
              />
              <button onClick={send} disabled={loading || !input.trim()}
                aria-label="Send"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
