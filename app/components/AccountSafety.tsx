"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "../lib/supabase/client";

// Local copies of the user's data, cleared whenever an account is removed.
const LOCAL_KEYS = ["decisioniq-reviews", "decisioniq-profile", "reel-onboarded", "reel-signup-data"];

async function deleteAccountEverywhere(): Promise<string | null> {
  const res = await fetch("/api/account/delete", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return data.error || "Couldn't delete your account. Email support@getreel.org.";
  try { LOCAL_KEYS.forEach(k => localStorage.removeItem(k)); } catch { /* storage unavailable */ }
  await createClient().auth.signOut();
  return null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Age from birth month + year. Day isn't asked (less data); the birth month
// itself counts as having had the birthday — at worst a few days generous.
function ageFrom(month: number, year: number, now = new Date()): number {
  let age = now.getFullYear() - year;
  if (month > now.getMonth()) age--;
  return age;
}

// One-time check after any sign-in (sign-up and "Log in" both create
// accounts). Neutral question, no hints about the cutoff. Only "13 or older:
// yes" is stored — never the birth date. Under 13, the account is deleted on
// the spot, as the Terms and Privacy Policy promise.
export function AgeGate({ onPassed }: { onPassed: () => void }) {
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [under13, setUnder13] = useState(false);
  const [error, setError] = useState("");
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 90 }, (_, i) => thisYear - 4 - i);

  async function submit() {
    setBusy(true); setError("");
    if (ageFrom(Number(month), Number(year)) < 13) {
      const err = await deleteAccountEverywhere();
      if (err) { setError(err); setBusy(false); return; }
      setUnder13(true); setBusy(false);
      return;
    }
    const { error } = await createClient().auth.updateUser({ data: { age_13_plus: true } });
    if (error) { setError("Couldn't save that. Try again."); setBusy(false); return; }
    onPassed();
  }

  const select = "w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40";
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="age-title">
      <div className="w-full max-w-md rounded-t-3xl bg-card p-6 shadow-lift sm:rounded-3xl sm:p-8">
        {under13 ? (
          <>
            <h2 id="age-title" className="font-display text-2xl text-foreground">A parent needs to set this up</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Reel accounts for athletes under 13 have to be created by a parent or guardian. We removed this sign-in and didn&apos;t keep anything from it.
            </p>
            <button onClick={() => { window.location.href = "/"; }} className="btn-pill btn-dark mt-6 w-full py-3 text-sm">OK</button>
          </>
        ) : (
          <>
            <h2 id="age-title" className="font-display text-2xl text-foreground">One quick question</h2>
            <p className="mt-1 text-sm text-muted-foreground">When were you born? We only keep whether you&apos;re 13 or older, not your birthday.</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <label className="sr-only" htmlFor="age-month">Birth month</label>
              <select id="age-month" value={month} onChange={e => setMonth(e.target.value)} className={select}>
                <option value="">Month</option>
                {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select>
              <label className="sr-only" htmlFor="age-year">Birth year</label>
              <select id="age-year" value={year} onChange={e => setYear(e.target.value)} className={select}>
                <option value="">Year</option>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
              By continuing, you agree to the <Link href="/terms" target="_blank" className="underline underline-offset-2">Terms</Link> and <Link href="/privacy" target="_blank" className="underline underline-offset-2">Privacy Policy</Link>. If you&apos;re under 18, you confirm a parent or guardian is okay with you using Reel.
            </p>
            {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
            <button onClick={submit} disabled={month === "" || year === "" || busy} className="btn-pill btn-dark mt-5 w-full py-3 text-sm disabled:opacity-40">
              {busy ? "One sec…" : "Continue"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Settings → Delete account. Typed confirmation, plain description of what
// goes, no guilt-trip copy.
export function DeleteAccountSection({ isPro }: { isPro?: boolean }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true); setError("");
    const err = await deleteAccountEverywhere();
    if (err) { setError(err); setBusy(false); return; }
    window.location.href = "/";
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-border py-2.5 text-sm text-muted-foreground transition-colors hover:border-red-900 hover:text-red-500">
        Delete account
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-red-500/30 p-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        This permanently deletes your account, games, clips, teams, drill checks and saved images.{isPro ? " Your Reel Pro subscription is cancelled immediately, with no partial-month refund." : ""} It can&apos;t be undone.
      </p>
      <label htmlFor="delete-confirm" className="block text-xs text-foreground">Type DELETE to confirm</label>
      <input id="delete-confirm" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40" />
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button onClick={confirm} disabled={typed !== "DELETE" || busy}
          className="flex-1 rounded-lg bg-red-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-40">
          {busy ? "Deleting…" : "Delete my account"}
        </button>
        <button onClick={() => { setOpen(false); setTyped(""); }}
          className="flex-1 rounded-lg border border-border py-2 text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
    </div>
  );
}
