import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getSessionUserId } from "../lib/supabase/server";
import { isOwner } from "../lib/usage";
import { loadAdminOverview } from "../lib/admin/users";
import { geminiHealth } from "../lib/ai/gemini";
import AdminUsers from "./AdminUsers";

// Owner-only. Anyone else — signed out, or signed in as a normal user — gets
// a plain 404, so the page's existence isn't advertised. Identity comes from
// the session cookie (never a query param), checked against OWNER_USER_IDS.

export const metadata: Metadata = { title: "Users | Reel admin", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const userId = await getSessionUserId();
  if (!userId || !isOwner(userId)) notFound();

  const [data, gemini] = await Promise.all([loadAdminOverview(), geminiHealth()]);
  const { funnel, lastWeek } = data;
  const pct = (n: number) => funnel.signedUp ? `${Math.round((n / funnel.signedUp) * 100)}%` : "-";
  const steps = [
    { label: "Signed up", value: funnel.signedUp, sub: "all time" },
    { label: "Analyzed anything", value: funnel.analyzed, sub: pct(funnel.analyzed) },
    { label: "Came back another day", value: funnel.returned, sub: pct(funnel.returned) },
    { label: "Pro", value: funnel.pro, sub: pct(funnel.pro) },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/" className="btn-pill btn-light !py-2 !text-[13px]">← Back to Reel</Link>
        <p className="text-[12px] text-muted-foreground">Owner only · loaded {new Date(data.loadedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</p>
      </div>

      {/* Service health: an empty Gemini balance silently breaks every
          YouTube-link analysis, so it's the first thing on this page. */}
      <div className={`surface mb-6 flex flex-wrap items-center gap-3 px-5 py-3.5 text-[14px] ${gemini.status === "ok" ? "" : "ring-2 ring-court"}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${gemini.status === "ok" ? "bg-emerald-500" : "bg-court"}`} />
        <span className="text-foreground">Gemini (video analysis):{" "}
          {gemini.status === "ok" ? "working"
            : gemini.status === "out_of_credits" ? <b className="text-court">OUT OF CREDITS. Link analysis is down for everyone. Top up in Google AI Studio → Billing.</b>
            : gemini.status === "not_configured" ? "not configured"
            : <span className="text-court">error: {gemini.detail}</span>}
        </span>
      </div>

      <h1 className="mb-8 font-display text-4xl font-normal leading-[1.05] sm:text-5xl">
        <span className="block">Users.</span>
        <span className="block text-quiet">Who&apos;s actually using Reel.</span>
      </h1>

      {/* Funnel */}
      <section className="surface mb-5 grid grid-cols-2 gap-y-6 p-5 sm:grid-cols-4 sm:p-6">
        {steps.map(s => (
          <div key={s.label}>
            <p className="font-display text-4xl tabular-nums leading-none">{s.value}</p>
            <p className="mt-2 text-[13px] text-foreground">{s.label}</p>
            <p className="text-[12px] text-muted-foreground">{s.sub}</p>
          </div>
        ))}
      </section>
      <p className="mb-8 text-[13px] text-muted-foreground">
        Last 7 days: <span className="text-foreground">{lastWeek.signups}</span> sign-ups ·{" "}
        <span className="text-foreground">{lastWeek.reviews}</span> reviews saved ·{" "}
        <span className={lastWeek.failedJobs ? "text-court" : "text-foreground"}>{lastWeek.failedJobs}</span> failed game analyses
      </p>

      <AdminUsers users={data.users} />
    </main>
  );
}
