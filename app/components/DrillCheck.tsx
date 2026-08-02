"use client";

import { useEffect, useState } from "react";
import { Dumbbell, Loader2, CheckCircle2, AlertTriangle, Upload, History } from "lucide-react";
import type { DrillFeedback, Profile } from "../lib/types";
import { parseDrillFeedback } from "../lib/analysis/parsers";
import { createClient } from "../lib/supabase/client";
import { formatDate } from "../lib/decisioniq-helpers";
import { Button } from "./ui/button";

type PastCheck = DrillFeedback & { id: string; createdAt: number };

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
  const [howto, setHowto] = useState("");
  const [howtoLoading, setHowtoLoading] = useState(false);
  const [history, setHistory] = useState<PastCheck[]>([]);
  const [openPast, setOpenPast] = useState<string | null>(null);

  // Load this player's recent drill checks so they can see progress over time.
  // RLS scopes the query to their own rows.
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    supabase.from("drill_checks").select("*").eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(20)
      .then(({ data }) => setHistory((data || []).map(rowToPast)));
  }, [userId]);

  function rowToPast(r: any): PastCheck {
    return {
      id: r.id, drill: r.drill, verdict: r.verdict ?? "unclear",
      didWell: r.did_well ?? "", mainFix: r.main_fix ?? "", focusNext: r.focus_next ?? "",
      createdAt: new Date(r.created_at).getTime(),
    };
  }

  async function saveCheck(fb: DrillFeedback) {
    if (!userId) return;
    const supabase = createClient();
    const { data } = await supabase.from("drill_checks").insert({
      user_id: userId, drill: fb.drill, verdict: fb.verdict,
      did_well: fb.didWell, main_fix: fb.mainFix, focus_next: fb.focusNext,
    }).select().single();
    if (data) setHistory(prev => [rowToPast(data), ...prev]);
  }

  async function showHowto() {
    if (!drill.trim() || howtoLoading) return;
    setHowtoLoading(true); setHowto("");
    try {
      const res = await fetch("/api/drill/howto", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drill: drill.trim(), sport: profile?.sport }),
      });
      const data = await res.json().catch(() => ({}));
      setHowto(data.howto || data.error || "Couldn't build instructions — try again.");
    } catch {
      setHowto("Couldn't build instructions — check your connection and try again.");
    } finally {
      setHowtoLoading(false);
    }
  }

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
      const fb = parseDrillFeedback(data.feedback ?? "", drill.trim());
      setFeedback(fb);
      saveCheck(fb);
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

      <div className="mb-3 flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={showHowto} disabled={!drill.trim() || howtoLoading}>
          {howtoLoading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Writing it up…</> : "Show me how to do it"}
        </Button>
        {howto && <button onClick={() => setHowto("")} className="text-xs text-muted-foreground hover:text-foreground">Hide</button>}
      </div>

      {howto && (
        <div className="mb-3 rounded-lg border border-border bg-muted p-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">How to do this drill</p>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">{howto}</pre>
        </div>
      )}

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

      {history.length > 0 && (
        <div className="mt-6 border-t border-border pt-4">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            <History className="h-3.5 w-3.5" /> Your recent checks
          </p>
          <div className="space-y-2">
            {history.map(p => {
              const v = VERDICT_UI[p.verdict];
              const isOpen = openPast === p.id;
              return (
                <div key={p.id} className="rounded-lg border border-border bg-muted/50 overflow-hidden">
                  <button onClick={() => setOpenPast(isOpen ? null : p.id)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold border ${v.cls}`}>{v.label}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{p.drill}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{formatDate(p.createdAt)}</span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-border px-3 py-2.5 space-y-1.5 text-xs">
                      {p.didWell && <p className="text-foreground"><span className="font-semibold text-emerald-500">Did well: </span>{p.didWell}</p>}
                      {p.mainFix && <p className="text-foreground"><span className="font-semibold text-amber-500">Fix: </span>{p.mainFix}</p>}
                      {p.focusNext && <p className="text-foreground"><span className="font-semibold text-emerald-400">Focus: </span>{p.focusNext}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
