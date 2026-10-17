"use client";

import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Clapperboard, Dumbbell, MessageCircle, Users } from "lucide-react";

export default function UpgradeModal({ user, onClose, hitLimit = true }: { user: User | null; onClose: () => void; hitLimit?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  async function upgrade() {
    if (!user) { setError("Sign in first to upgrade."); return; }
    setLoading(true); setError("");
    try {
      // Identity comes from the session cookie server-side; no body needed.
      const res  = await fetch("/api/stripe/checkout", { method: "POST" });
      const data = await res.json();
      if (data.url) { window.location.href = data.url; }
      else { setError("Something went wrong. Try again."); setLoading(false); }
    } catch {
      setError("Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm backdrop-blur-sm p-0 sm:p-6 modal-in">
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="relative border-b border-border px-8 py-6 text-center">
          <button onClick={onClose} aria-label="Close"
            className="absolute right-5 top-5 text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">✕</button>
          <p className="text-[12px] text-muted-foreground mb-2">Reel Pro</p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">{hitLimit ? "You've hit your free limit" : "Upgrade to Reel Pro"}</h2>
          <p className="mt-2 text-sm text-muted-foreground">Upgrade to Reel Pro for more games and clips every month.</p>
        </div>

        {/* Features */}
        <div className="px-8 py-6 space-y-3">
          {[
            { icon: Clapperboard, text: "8 full games + 100 clips a month (free: 1 + 2)" },
            { icon: MessageCircle, text: "1,000 coach messages a month (free: 15)"       },
            { icon: Dumbbell,     text: "50 practice plans a month (free: 1)"           },
            { icon: Users,        text: "Unlimited teams (free: 1)"                     },
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
              <p className="text-2xl font-semibold text-foreground">$8<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
            </div>
          </div>

          <p className="text-center text-xs leading-relaxed text-muted-foreground">
            $8 a month, renews automatically until you cancel. Cancel anytime in Settings → Manage subscription; Pro stays on until the end of the month you paid for. No partial-month refunds. <a href="/refunds" target="_blank" className="underline underline-offset-2">Refund policy</a>
          </p>

          {error && <p className="text-xs text-red-600 dark:text-red-400 text-center">{error}</p>}

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
