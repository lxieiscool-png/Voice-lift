"use client";

import { useEffect, useRef, useState } from "react";
import type { PlayerDecision } from "../lib/types";
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
export default function FilmRoom({ videoId, decisions, onClose }: {
  videoId: string;
  decisions: PlayerDecision[];
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  // Only moments we can actually place on the tape are seekable.
  const placed = decisions.filter(d => timestampSeconds(d.timestamp) !== Number.MAX_SAFE_INTEGER);
  const unplaced = decisions.filter(d => timestampSeconds(d.timestamp) === Number.MAX_SAFE_INTEGER);

  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || !hostRef.current || !window.YT?.Player) return;
      playerRef.current = new window.YT.Player(hostRef.current, {
        videoId,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: { onReady: () => !cancelled && setReady(true) },
      });
    });
    return () => {
      cancelled = true;
      try { playerRef.current?.destroy?.(); } catch { /* already gone */ }
      playerRef.current = null;
    };
  }, [videoId]);

  function jumpTo(d: PlayerDecision, i: number) {
    setActiveIdx(i);
    const secs = timestampSeconds(d.timestamp);
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
          ← Back to report
        </button>
        <p className="text-sm font-black text-foreground">Film Room</p>
        <span className="text-xs text-muted-foreground">{placed.length} moments</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="bg-black lg:flex-1">
          <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
            <div ref={hostRef} className="absolute inset-0 h-full w-full" />
          </div>
          {!ready && <p className="p-3 text-center text-xs text-muted-foreground">Loading film…</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border lg:max-w-[420px] lg:flex-none lg:border-l lg:border-t-0">
          <p className="sticky top-0 z-10 border-b border-border bg-background px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Tap a moment to jump there
          </p>
          {placed.map((d, i) => {
            const active = activeIdx === i;
            return (
              <button key={i} onClick={() => jumpTo(d, i)}
                className={`block w-full border-b border-border px-4 py-3 text-left transition-colors ${active ? "bg-muted" : "hover:bg-muted/50"}`}>
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-xs font-bold text-foreground">{d.timestamp}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${gradeClass(d.grade, "bg")} ${gradeClass(d.grade, "text")}`}>
                    {d.grade || "N/A"}
                  </span>
                  <span className="truncate text-xs font-semibold text-foreground">{d.player}</span>
                </div>
                <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{d.action || d.whatHappened}</p>
                {active && (
                  <div className="mt-3 space-y-2.5 border-t border-border pt-3">
                    {d.decisionRead && (
                      <div>
                        <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">The read</p>
                        <p className="text-xs leading-relaxed text-foreground">{d.decisionRead}</p>
                      </div>
                    )}
                    {d.bestAlternative && (
                      <div>
                        <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Better option</p>
                        <p className="text-xs leading-relaxed text-foreground">{d.bestAlternative}</p>
                      </div>
                    )}
                    {d.practiceFocus && (
                      <div>
                        <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Drill it</p>
                        <p className="text-xs leading-relaxed text-foreground">{d.practiceFocus}</p>
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
          {unplaced.length > 0 && (
            <p className="px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
              {unplaced.length} more {unplaced.length === 1 ? "moment couldn't" : "moments couldn't"} be placed on the tape — they&apos;re in the full report below.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
