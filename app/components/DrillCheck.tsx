"use client";

import { useState } from "react";
import { Dumbbell, Loader2, CheckCircle2, AlertTriangle, Upload } from "lucide-react";
import type { DrillFeedback, Profile } from "../lib/types";
import { parseDrillFeedback } from "../lib/analysis/parsers";
import { Button } from "./ui/button";

// Short single-player clip → sample ~18 frames evenly. A drill is one person
// close to the camera, so we don't need the game path's density or motion
// filtering — just enough stills to read the motion.
async function extractDrillFrames(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) { reject(new Error("Canvas failed.")); return; }
    const url = URL.createObjectURL(file);
    video.src = url; video.muted = true; video.playsInline = true;
    video.onloadedmetadata = async () => {
      const duration = video.duration || 1;
      const MAX = 18;
      const cap = Math.min(duration, 40);
      const step = Math.max(cap / MAX, 0.4);
      const times: number[] = [];
      for (let t = 0.2; t < cap; t += step) times.push(Number(t.toFixed(2)));
      if (!times.length) times.push(Math.min(duration / 2, 0.2));
      canvas.width = 1280; canvas.height = 720;
      const frames: string[] = [];
      for (const time of times) {
        await new Promise<void>((done) => {
          video.currentTime = time;
          video.onseeked = () => {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            frames.push(canvas.toDataURL("image/jpeg", 0.85));
            done();
          };
        });
      }
      URL.revokeObjectURL(url);
      resolve(frames);
    };
    video.onerror = () => reject(new Error("Video failed to load."));
  });
}

const VERDICT_UI: Record<DrillFeedback["verdict"], { label: string; cls: string }> = {
  yes:     { label: "Looking good",   cls: "text-emerald-400 border-emerald-900/60 bg-emerald-950/30" },
  mostly:  { label: "Mostly there",   cls: "text-lime-400 border-lime-900/60 bg-lime-950/30" },
  no:      { label: "Needs work",     cls: "text-amber-400 border-amber-900/60 bg-amber-950/30" },
  unclear: { label: "Couldn't tell",  cls: "text-muted-foreground border-border bg-muted" },
};

export default function DrillCheck({ profile, userId, initialDrill = "" }: {
  profile?: Profile; userId?: string; initialDrill?: string;
}) {
  const [drill, setDrill] = useState(initialDrill);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<DrillFeedback | null>(null);

  async function run() {
    if (!drill.trim() || !file) return;
    setLoading(true); setError(""); setFeedback(null);
    try {
      const frames = await extractDrillFrames(file);
      const res = await fetch("/api/drill", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drill: drill.trim(), frames, sport: profile?.sport, userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403 && data.error === "limit_reached") { setError("You've hit your free limit — upgrade to keep checking drills."); return; }
      if (data.error) { setError(data.error); return; }
      if (!res.ok) { setError(`Server error ${res.status}`); return; }
      setFeedback(parseDrillFeedback(data.feedback ?? "", drill.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const verdict = feedback ? VERDICT_UI[feedback.verdict] : null;

  return (
    <div className="rounded-2xl border border-border bg-gradient-to-b from-muted/60 to-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <Dumbbell className="h-4 w-4 text-muted-foreground" />
        <div>
          <p className="text-sm font-semibold text-foreground">Drill Check</p>
          <p className="text-xs text-muted-foreground">Record yourself doing a drill — get instant form feedback.</p>
        </div>
      </div>

      <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">The drill you're working on</label>
      <textarea
        value={drill}
        onChange={e => setDrill(e.target.value)}
        placeholder="Paste the drill from your report, or describe it — e.g. 'Form shooting: one-hand follow-through, 3 sets of 20, hold the finish.'"
        rows={2}
        className="mb-3 w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-ring"
      />

      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted px-3 py-4 text-sm text-muted-foreground hover:border-ring">
        <Upload className="h-4 w-4" />
        {file ? file.name : "Upload a clip of yourself doing the drill"}
        <input type="file" accept="video/*" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
      </label>

      <Button onClick={run} disabled={loading || !drill.trim() || !file} size="lg" className="mt-3 w-full">
        {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Checking your form…</> : "Check my drill"}
      </Button>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2.5 text-sm text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {feedback && verdict && (
        <div className="mt-4 space-y-3">
          <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${verdict.cls}`}>
            <CheckCircle2 className="h-4 w-4" /> {verdict.label}
          </div>
          {feedback.didWell && (
            <div className="rounded-lg bg-muted p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-500">What you did well</p>
              <p className="text-sm text-foreground leading-relaxed">{feedback.didWell}</p>
            </div>
          )}
          {feedback.mainFix && (
            <div className="rounded-lg bg-muted p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-amber-500">Fix this</p>
              <p className="text-sm text-foreground leading-relaxed">{feedback.mainFix}</p>
            </div>
          )}
          {feedback.focusNext && (
            <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-400">Next rep, focus on</p>
              <p className="text-sm text-foreground leading-relaxed">{feedback.focusNext}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
