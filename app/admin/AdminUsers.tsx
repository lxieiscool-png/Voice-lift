"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import type { AdminUser } from "../lib/admin/users";
import { StatTable, StatHeader, type StatCol } from "../components/ui/stat-table";
import { Segmented } from "../components/ui/segmented";

type Filter = "all" | "never" | "active" | "failed" | "pro";

const ago = (iso: string | null) => {
  if (!iso) return "—";
  const d = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (d < 1 / 24) return "just now";
  if (d < 1) return `${Math.round(d * 24)}h ago`;
  if (d < 30) return `${Math.round(d)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
};
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function AdminUsers({ users }: { users: AdminUser[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);

  const counts = {
    all: users.length,
    never: users.filter(u => u.clips + u.games === 0).length,
    active: users.filter(u => u.activeDays >= 2).length,
    failed: users.filter(u => u.failedJobs > 0).length,
    pro: users.filter(u => u.isPro).length,
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter(u => {
      if (filter === "never" && u.clips + u.games > 0) return false;
      if (filter === "active" && u.activeDays < 2) return false;
      if (filter === "failed" && u.failedJobs === 0) return false;
      if (filter === "pro" && !u.isPro) return false;
      if (!needle) return true;
      return [u.email, u.name, u.sport, u.team].some(v => v?.toLowerCase().includes(needle));
    });
  }, [users, q, filter]);

  const cols: StatCol<AdminUser>[] = [
    { key: "joined", label: "Joined", value: u => day(u.joined), muted: true },
    { key: "seen", label: "Last active", value: u => ago(u.lastActive ?? u.lastSignIn) },
    { key: "clips", label: "Clips", value: u => u.clips || <span className="text-muted-foreground">0</span>, lead: u => u.clips },
    { key: "games", label: "Games", value: u => u.games || <span className="text-muted-foreground">0</span>, lead: u => u.games },
    { key: "days", label: "Days", title: "Distinct days with a saved review", value: u => u.activeDays, lead: u => u.activeDays },
    { key: "coach", label: "Coach", title: "Coach messages this month", value: u => u.monthCoachMsgs, muted: true },
    { key: "fail", label: "Failed", title: "Failed game analyses", value: u => u.failedJobs ? <span className="text-court">{u.failedJobs}</span> : <span className="text-muted-foreground">0</span> },
    { key: "pro", label: "Plan", value: u => u.isPro ? <span className="rounded-full bg-foreground px-2 py-0.5 text-[11px] text-background">Pro</span> : <span className="text-muted-foreground">Free</span> },
  ];

  return (
    <section className="surface p-5 sm:p-6">
      <StatHeader title="All users" sub={`${rows.length} of ${users.length} shown · tap a row for their reviews`}
        right={
          <label className="flex items-center gap-2 rounded-full bg-muted px-3.5 py-2 text-[13px]">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search email, name, team"
              className="w-44 bg-transparent text-foreground outline-none placeholder:text-muted-foreground" />
          </label>
        } />
      <div className="mb-4 overflow-x-auto">
        <Segmented value={filter} onChange={setFilter} options={[
          { value: "all", label: "All", count: counts.all },
          { value: "never", label: "Never analyzed", count: counts.never },
          { value: "active", label: "Came back", count: counts.active },
          { value: "failed", label: "Had a failure", count: counts.failed },
          { value: "pro", label: "Pro", count: counts.pro },
        ]} />
      </div>

      <StatTable cols={cols} rows={rows} rowKey={u => u.id} nameHeader="User" minWidth={820}
        onRowClick={u => setOpen(open === u.id ? null : u.id)}
        isExpanded={u => open === u.id}
        renderExpanded={u => <UserDetail u={u} />}
        name={u => (
          <span className="flex items-center gap-2">
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open === u.id ? "" : "-rotate-90"}`} />
            <span className="min-w-0">
              <span className="block max-w-[15rem] truncate text-foreground">{u.name || u.email || "No name"}</span>
              <span className="block max-w-[15rem] truncate text-[12px] text-muted-foreground">
                {u.name ? u.email : ""}{[u.sport, u.team].filter(Boolean).length ? `${u.name ? " · " : ""}${[u.sport, u.team].filter(Boolean).join(" · ")}` : ""}
              </span>
            </span>
          </span>
        )} />
      {rows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No users match.</p>}
    </section>
  );
}

function UserDetail({ u }: { u: AdminUser }) {
  return (
    <div className="grid gap-6 whitespace-normal px-5 py-4 text-left sm:grid-cols-2 sm:px-6">
      <div>
        <p className="mb-2 text-[12px] text-muted-foreground">
          Recent reviews ({u.clips + u.games}) · {u.teams} {u.teams === 1 ? "team" : "teams"} · {u.drillChecks} drill checks · last sign-in {ago(u.lastSignIn)}
        </p>
        {u.reviews.length === 0 ? <p className="text-[13px] text-muted-foreground">Nothing analyzed yet.</p> : (
          <ul className="divide-y divide-border">
            {u.reviews.map(r => (
              <li key={r.id} className="flex items-center gap-3 py-1.5 text-[13px]">
                <span className="w-12 shrink-0 text-muted-foreground">{day(r.created_at)}</span>
                <span className="w-10 shrink-0 text-muted-foreground">{r.mode}</span>
                <span className="min-w-0 flex-1 truncate text-foreground">{r.file_name || "Untitled"}</span>
                <span className="shrink-0 tabular-nums text-foreground">{r.grade || "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-2 text-[12px] text-muted-foreground">Failed game analyses ({u.failedJobs})</p>
        {u.failures.length === 0 ? <p className="text-[13px] text-muted-foreground">None.</p> : (
          <ul className="divide-y divide-border">
            {u.failures.map((f, i) => (
              <li key={i} className="py-1.5 text-[13px]">
                <span className="text-muted-foreground">{day(f.created_at)} · </span>
                <span className="text-foreground">{f.file_name || "Untitled"}</span>
                <p className="text-[12px] text-court">{f.error || "No error message saved"}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 font-mono text-[11px] text-muted-foreground">{u.id}</p>
      </div>
    </div>
  );
}
