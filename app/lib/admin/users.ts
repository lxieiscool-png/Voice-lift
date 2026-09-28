import { createAdminClient } from "../supabase/admin";

// Owner-only user overview. Service-role reads, so this must only ever be
// imported by server code (app/admin/page.tsx) and called after the caller
// has been checked with isOwner() — never from a client component.

export type AdminReview = { id: string; mode: string; grade: string | null; file_name: string | null; created_at: string };
export type AdminJob = { status: string; error: string | null; file_name: string | null; created_at: string };

export type AdminUser = {
  id: string;
  email: string | null;
  name: string | null;
  sport: string | null;
  team: string | null;
  joined: string;
  lastSignIn: string | null;
  lastActive: string | null;       // latest review or job, whichever is newer
  isPro: boolean;
  clips: number;
  games: number;
  activeDays: number;              // distinct days with a saved review
  failedJobs: number;
  teams: number;
  drillChecks: number;
  monthCoachMsgs: number;
  reviews: AdminReview[];          // newest first
  failures: AdminJob[];            // newest first
};

export type AdminOverview = {
  users: AdminUser[];
  funnel: { signedUp: number; analyzed: number; returned: number; pro: number };
  lastWeek: { signups: number; reviews: number; failedJobs: number };
  loadedAt: string;
};

const DAY = 86_400_000;

export async function loadAdminOverview(): Promise<AdminOverview> {
  const db = createAdminClient();
  const [authRes, profilesRes, reviewsRes, jobsRes, teamsRes, drillsRes] = await Promise.all([
    db.auth.admin.listUsers({ perPage: 1000 }),
    db.from("profiles").select("id,name,sport,team,is_pro,monthly_coach_msgs"),
    db.from("reviews").select("id,user_id,mode,grade,file_name,created_at").order("created_at", { ascending: false }).limit(5000),
    db.from("analysis_jobs").select("user_id,status,error,file_name,created_at").order("created_at", { ascending: false }).limit(5000),
    db.from("teams").select("coach_user_id"),
    db.from("drill_checks").select("user_id"),
  ]);

  const profiles = new Map((profilesRes.data ?? []).map(p => [p.id as string, p]));
  const byUser = <T extends { user_id?: string | null }>(rows: T[] | null) => {
    const m = new Map<string, T[]>();
    for (const r of rows ?? []) { if (!r.user_id) continue; if (!m.has(r.user_id)) m.set(r.user_id, []); m.get(r.user_id)!.push(r); }
    return m;
  };
  const reviews = byUser(reviewsRes.data as (AdminReview & { user_id: string })[] | null);
  const jobs = byUser(jobsRes.data as (AdminJob & { user_id: string })[] | null);
  const drills = byUser(drillsRes.data as { user_id: string }[] | null);
  const teamCount = new Map<string, number>();
  for (const t of teamsRes.data ?? []) teamCount.set(t.coach_user_id, (teamCount.get(t.coach_user_id) ?? 0) + 1);

  const users: AdminUser[] = (authRes.data?.users ?? []).map(u => {
    const p = profiles.get(u.id);
    const rv = reviews.get(u.id) ?? [];
    const jb = jobs.get(u.id) ?? [];
    const latest = [rv[0]?.created_at, jb[0]?.created_at].filter(Boolean).sort().pop() ?? null;
    return {
      id: u.id,
      email: u.email ?? null,
      name: (p?.name as string) || (u.user_metadata?.full_name as string) || null,
      sport: (p?.sport as string) || null,
      team: (p?.team as string) || null,
      joined: u.created_at,
      lastSignIn: u.last_sign_in_at ?? null,
      lastActive: latest,
      isPro: !!p?.is_pro,
      clips: rv.filter(r => r.mode === "clip").length,
      games: rv.filter(r => r.mode === "game").length,
      activeDays: new Set(rv.map(r => r.created_at.slice(0, 10))).size,
      failedJobs: jb.filter(j => j.status === "failed").length,
      teams: teamCount.get(u.id) ?? 0,
      drillChecks: drills.get(u.id)?.length ?? 0,
      monthCoachMsgs: (p?.monthly_coach_msgs as number) ?? 0,
      reviews: rv.slice(0, 25).map(({ id, mode, grade, file_name, created_at }) => ({ id, mode, grade, file_name, created_at })),
      failures: jb.filter(j => j.status === "failed").slice(0, 10).map(({ status, error, file_name, created_at }) => ({ status, error, file_name, created_at })),
    };
  }).sort((a, b) => b.joined.localeCompare(a.joined));

  const since = Date.now() - 7 * DAY;
  const recent = (iso: string) => new Date(iso).getTime() >= since;
  return {
    users,
    funnel: {
      signedUp: users.length,
      analyzed: users.filter(u => u.clips + u.games > 0).length,
      returned: users.filter(u => u.activeDays >= 2).length,
      pro: users.filter(u => u.isPro).length,
    },
    lastWeek: {
      signups: users.filter(u => recent(u.joined)).length,
      reviews: (reviewsRes.data ?? []).filter(r => recent(r.created_at)).length,
      failedJobs: (jobsRes.data ?? []).filter(j => j.status === "failed" && recent(j.created_at)).length,
    },
    loadedAt: new Date().toISOString(),
  };
}
