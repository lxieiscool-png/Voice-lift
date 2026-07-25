"use client";

import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Clapperboard, BarChart3, Dumbbell, Share2, TrendingUp } from "lucide-react";

export default function UpgradeModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  async function upgrade() {
    if (!user) { setError("Sign in first to upgrade."); return; }
    setLoading(true); setError("");
    try {
      const res  = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, email: user.email }),
      });
      const data = await res.json();
      if (data.url) { window.location.href = data.url; }
      else { setError("Something went wrong. Try again."); setLoading(false); }
    } catch {
      setError("Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/90 backdrop-blur-sm p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="relative border-b border-border px-8 py-6 text-center">
          <button onClick={onClose}
            className="absolute right-5 top-5 text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">✕</button>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Reel Pro</p>
          <h2 className="text-2xl font-black tracking-tight text-foreground">You&apos;ve hit your free limit</h2>
          <p className="mt-2 text-sm text-muted-foreground">Upgrade to Reel Pro for more games and clips every month.</p>
        </div>

        {/* Features */}
        <div className="px-8 py-6 space-y-3">
          {[
            { icon: Clapperboard, text: "8 full game analyses + 100 clips a month"   },
            { icon: BarChart3,    text: "Full player breakdowns and grade history"  },
            { icon: Dumbbell,     text: "Personalized practice plans from CoachIQ" },
            { icon: Share2,       text: "Share grade cards and Stories"             },
            { icon: TrendingUp,   text: "Grade trend tracking across all sessions"  },
          ].map(f => (
            <div key={f.text} className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/80"><f.icon className="h-3.5 w-3.5 text-foreground" strokeWidth={1.75} /></span>
              <p className="text-sm text-foreground">{f.text}</p>
            </div>
          ))}
        </div>

        {/* Pricing + CTA */}
        <div className="px-8 pb-8 space-y-3">
          <div className="rounded-xl border border-border bg-muted px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-base font-bold text-foreground">Reel Pro</p>
              <p className="text-xs text-muted-foreground">Billed monthly</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black text-foreground">$8<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
            </div>
          </div>

          {error && <p className="text-xs text-red-400 text-center">{error}</p>}

          <button onClick={upgrade} disabled={loading}
            className="w-full rounded-xl bg-primary py-4 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {loading ? "Opening checkout…" : "Upgrade to Pro →"}
          </button>

          <button onClick={onClose}
            className="w-full text-xs text-muted-foreground hover:text-muted-foreground transition-colors py-1">
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
