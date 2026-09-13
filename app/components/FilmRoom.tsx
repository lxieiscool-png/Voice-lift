"use client";

import { useEffect, useRef, useState } from "react";
import type { PlayerDecision, GameReport } from "../lib/types";
import { timestampSeconds } from "../lib/analysis/parsers";
import { gradeClass } from "../lib/shared";

// Pull a YouTube id out of whatever we stored on the review. Reviews record
// the source as "YouTube: <url>" in file_name, so this also lights up film
// rooms for analyses that were run before this view existed.
export function youtubeIdFrom(text?: string | null): string | null {
  if (!text) return null;
  const m = text.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

declare global { interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void } }

// Load YouTube's iframe API once per page, shared by every mount.
let apiPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
}

// Film study the way a coach actually does it: the footage on one side, the
// graded moments on the other, and clicking a moment jumps the tape there.
export default function FilmRoom({ videoId, decisions, timeline = [], onClose }: {
  videoId: string;
  decisions: PlayerDecision[];
  // Every logged possession. The cards above are the curated few; this is the
  // dense feed, so a 45-minute game reads as a full game rather than a
  // highlight reel.
  timeline?: NonNullable<GameReport["timeline"]>;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const [filter, setFilter] = useState<"all" | "good" | "poor">("all");

  // The feed is every logged possession; a coachable card attaches to the one
  // it was written about, matched on timestamp.
  const cardAt = new Map<string, PlayerDecision>();
  for (const d of decisions) if (d.timestamp) cardAt.set(d.timestamp, d);

  const placedCards = decisions.filter(d => timestampSeconds(d.timestamp) !== Number.MAX_SAFE_INTEGER);
  // Fall back to the cards themselves when no raw feed came through, so this
  // still works for clips and for reports analyzed before the feed existed.
  const feed = timeline.length > 0
    ? timeline.filter(e => e.seconds !== Number.MAX_SAFE_INTEGER)
    : placedCards.map(d => ({
        timestamp: d.timestamp ?? "", seconds: timestampSeconds(d.timestamp),
        player: d.player, quality: "neutral" as const, description: d.action || d.whatHappened,
      }));

  const shown = feed.filter(e => filter === "all" || e.quality === filter);
  const counts = {
    all: feed.length,
    good: feed.filter(e => e.quality === "good").length,
    poor: feed.filter(e => e.quality === "poor").length,
  };

  function jumpTo(secs: number, i: number) {
    setActiveIdx(i);
    if (secs === Number.MAX_SAFE_INTEGER) return;
    // Start a couple of seconds early so the play develops on screen.
    const cue = Math.max(0, secs - 2);
    try {
      playerRef.current?.seekTo(cue, true);
      playerRef.current?.playVideo?.();
    } catch { /* player not ready yet */ }
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <button onClick={onClose}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-ring hover:text-foreground">
          Back to report
        </button>
        <p className="font-display text-sm font-bold text-foreground">Film Room</p>
        <span className="text-xs text-muted-foreground">{feed.length} plays</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="bg-black lg:flex-1">
          <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
            <div ref={hostRef} className="absolute inset-0 h-full w-full" />
          </div>
          {!ready && <p className="p-3 text-center text-xs text-muted-foreground">Loading film…</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border lg:max-w-[420px] lg:flex-none lg:border-l lg:border-t-0">
          <div className="sticky top-0 z-10 flex gap-1 border-b border-border bg-background px-3 py-2">
            {([["all", "All"], ["good", "Good"], ["poor", "Mistakes"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${filter === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {label} <span className="opacity-60">{counts[k]}</span>
              </button>
            ))}
          </div>

          {shown.map((e, i) => {
            const active = activeIdx === i;
            const card = cardAt.get(e.timestamp);
            const dot = e.quality === "good" ? "bg-emerald-500" : e.quality === "poor" ? "bg-red-500" : "bg-muted-foreground";
            return (
              <button key={`${e.timestamp}-${i}`} onClick={() => jumpTo(e.seconds, i)}
                className={`block w-full border-b border-border px-4 py-3 text-left transition-colors ${active ? "bg-muted" : "hover:bg-muted/50"}`}>
                <div className="flex items-center gap-2.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
                  <span className="font-mono text-xs font-bold text-foreground">{e.timestamp}</span>
                  <span className="truncate text-xs font-semibold text-foreground">{e.player}</span>
                  {card && (
                    <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black ${gradeClass(card.grade, "bg")} ${gradeClass(card.grade, "text")}`}>
                      {card.grade}
                    </span>
                  )}
                </div>
                {e.description && <p className="mt-1 pl-4.5 text-xs leading-snug text-muted-foreground">{e.description}</p>}
                {active && card && (
                  <div className="mt-3 space-y-2.5 border-t border-border pt-3">
                    {card.decisionRead && (
                      <div>
                        <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">The read</p>
                        <p className="text-xs leading-relaxed text-foreground">{card.decisionRead}</p>
                      </div>
                    )}
                    {card.bestAlternative && (
                      <div>
                        <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Better option</p>
                        <p className="text-xs leading-relaxed text-foreground">{card.bestAlternative}</p>
                      </div>
                    )}
                    {card.practiceFocus && (
                      <div>
                        <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Drill it</p>
                        <p className="text-xs leading-relaxed text-foreground">{card.practiceFocus}</p>
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
          {shown.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">No plays match this filter.</p>
          )}
        </div>
      </div>
    </div>
  );
}
