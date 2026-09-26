# Reel — Handoff Brief
_Current as of 2026-09-26. Supersedes the 2026-07-27 brief._

AI sports-coaching web app. Upload/paste film → AI grades decisions, coaches, prescribes drills.
Live at **https://www.getreel.org** (Vercel, auto-deploys on push to `main`).

---

## Essentials

- **Project:** `/Users/lxiei/Decision IQ/decisioniq` — Next.js 16 / Turbopack, Tailwind v4 (CSS-first, tokens in `app/globals.css`).
- **Non-standard build:** read `node_modules/next/dist/docs/` before touching framework conventions (per AGENTS.md).
- **Repo:** `github.com/lxieiscool-png/Voice-lift.git`
- **Supabase:** one project (dev+prod), Google OAuth, Postgres, Storage, RLS. Project ref `ykuhyjocnwgrpxhbpafx`.
- **Owner user id:** `958e9167-3482-4171-9208-e3f9b5365b9c` (Lucy, `lxieiscool@gmail.com`)

## Standing preferences

- **Auto-deploy:** commit + push to `main` directly, no asking.
- User is hands-on, non-technical-ish. **Give blunt, honest assessments — push back on bad ideas.** They explicitly value this and have killed their own ideas on honest advice.
- **Flag before touching:** Supabase auth flows, billing/Stripe/usage-gate logic.
- **Schema changes:** propose SQL, user runs it in the Supabase SQL editor. Never blind-execute DDL.
- **Verify everything:** `npx tsc --noEmit -p .`, `npm run build`, then the `/deploy-check` skill after every push. Never call work done on a failing check.
- **Build gotcha:** Turbopack fails flakily — re-run once before assuming it's your code. Never pipe `npm run build` through grep (masks exit code).
- **`git add -A` burned us once** — it swept an unrelated working-tree revert into a commit and deleted the whole landing redesign. **Stage specific files on this project.**

---

## What Reel does now

**Three ways to get film in** (DecisionIQ → two tabs):
1. **Paste a public YouTube link** (primary). Gemini ingests YouTube natively — Google serving Google, nothing to download, nothing to block.
2. **Screen capture** (fallback, under "Film not on public YouTube?"). Browser `getDisplayMedia`; works for unlisted YouTube, HUDL, anything behind a login. **Desktop only** — no mobile browser support.
3. **Upload a video file** (Upload tab).

**Clip vs game:** decided by the user's own "Team game footage / Just a clip" toggle (primary), with duration as a backstop that only overrides when known AND ≤120s.

- **Clip** → one AI pass → timestamped player cards, returned inline (~30s).
- **Game** → split into **4-minute windows** (`WINDOW_SECONDS=240`, `MAX_WINDOWS=20`), analyzed concurrently via Gemini time offsets, run as an **Inngest background job**, then tallied + synthesized. User can close the tab; result lands in Library.

**Outputs:**
- Timestamped coachable cards, chronological, rendered as a timeline with a left rail.
- **Full decision timeline** — every logged possession (`buildDecisionTimeline`), dense feed.
- Box score (basketball) or volleyball scorebook — tallied **in our code**, never by the model.
- Game report: overall grade, Your Grade, Did Well / Work On, team comparison.
- **Film Room** — YouTube player + synchronized timeline; click a moment, tape seeks there (2s early) and plays. All / Good / Mistakes filters.

**CoachIQ:** Ask Coach (chat), Build My Plan (weekly solo plan), Drill Check (record a drill → form feedback).
**Teams:** create team, roster with jersey numbers, link games, season record. **Library:** past reviews.

---

## AI providers

Per-feature switch in `app/lib/ai/gemini.ts`:

| Env var | Controls | Current |
|---|---|---|
| `AI_PROVIDER_GAMES` | game segments, prechecks, synthesis | **unset → OpenAI** |
| `AI_PROVIDER_CLIPS` | deep clip pass, drill checks | unset → OpenAI |
| `AI_PROVIDER_CHAT` | coach chat, plans, drills, support | unset → OpenAI |
| `AI_PROVIDER` | global fallback | unset |

Set any to `gemini`. **The YouTube link path always uses Gemini** regardless — OpenAI has no video ingestion.

- Gemini billing is **live** (Tier 1 Prepay, paid tier → no training on user data).
- Models: `gemini-3.7-flash`, falls back to `gemini-3.6-flash` on transient 500s. Retries with backoff.
- **Measured latency (paid tier):** text 2.2s · clip 29s · game window 15s · real YouTube clip 26s.
- **Cost:** ~$0.15/game on Gemini vs ~$0.55 on OpenAI. Clips are the real cost driver at scale (reasoning model × 100/mo Pro allowance), not games.
- **Gemini gotchas:** video offsets are **duration strings** (`"480s"`) not numbers — the docs example is wrong. `resolution: "high"` is set for jersey legibility.

---

## Plans & limits (server-enforced)

| | Free | Pro ($8/mo) |
|---|---|---|
| Games | 1/mo | 8/mo |
| Clips (incl. drill checks) | 2/mo | 100/mo |
| Coach messages | 15/mo | 1000/mo |
| Practice plans | 1/mo | 50/mo |
| Teams | 1 | unlimited |
| Guests (no account) | 3 clips + 1 game per IP/mo | — |

- Gate is server-side; identity from the **session cookie**, never a request body.
- Failed analyses **refund** the credit.
- **Owner bypass:** `OWNER_USER_IDS` (or `OWNER_USER_ID`) env — unlimited, reads as Pro.
- Every limit hit opens the Pro upgrade modal.

---

## Key files

- `app/lib/ai/gemini.ts` — Gemini client: video URLs, time windows, fps, resolution, retries, friendly errors.
- `app/lib/ai/chat.ts` — provider-agnostic text completion.
- `app/lib/analysis/analyzeChunk.ts` — clip + game-segment prompts (rubric, honesty, jersey rules, per-sport depth, video vs frames).
- `app/lib/analysis/synthesize.ts` — game report + coachable moments.
- `app/lib/analysis/parsers.ts` — `parsePlayerBlocks`, `parseGameReport`, `buildBoxScore`, `buildVolleyBoxScore`, `buildDecisionTally`, **`buildDecisionTimeline`**, `timestampSeconds`.
- `app/lib/inngest/functions.ts` — background game job (frames **and** windowed video paths).
- `app/lib/usage.ts` — limits, owner bypass. `app/lib/guestUsage.ts` — per-IP guest caps.
- `app/components/DecisionIQ.tsx` — huge: upload UI, PlayerCard (timeline), GameResultsView, FilmLibrary.
- `app/components/FilmRoom.tsx` — video + synchronized timeline.
- `app/api/youtube-analyze/route.ts` — link analysis; clips inline, games queue a job.
- Routes: `/api/analyze`, `/api/synthesize`, `/api/jobs/*`, `/api/drill*`, `/api/coach`, `/api/plan`, `/api/support`, `/api/thumbnail`, `/api/youtube-frames`, `/api/stripe/*`, `/api/usage`.

---

## Design language (just reworked — don't regress it)

- **Fonts:** body = Geist, headings/nav = Archivo via `.font-display`. (`body{font-family:Arial}` in globals.css was overriding both for months — fixed.)
- **Left nav rail** for DecisionIQ/CoachIQ/Library/Teams; collapses to a horizontal scroller under `lg`.
- **Flat surfaces.** Radius stepped down (2xl/3xl→xl, xl→lg). No gradient panels. No boxes nested 3 deep. Whitespace and thin rules do the separating. Inspired by Dropbox/HoopIQ.
- **No decorative glyphs** (⊙ ✦ ⌁ and ornamental arrows are gone). Real lucide icons only.
- Analysis cards render as a **timeline**: left rail with mono timestamp + team-coloured node, compact grade pill, 2-line clamp; expanded uses dividers not stacked grey boxes.
- Landing page is a separate dark editorial design (hero video, heavy/outline Archivo type). **It was accidentally deleted once — if it looks "old", check git before rebuilding.**

---

## Database

- `profiles`: id, name, sport, team, created_at, is_pro, monthly_analyses, month_key, monthly_games, **monthly_coach_msgs**, **monthly_plans**, stripe_customer_id
- `reviews` (team_id, opponent_name, game_type, game_date, thumbnail_url, data JSONB), `teams`, `team_members` (jersey_number), `analysis_jobs`, `drill_checks`, **`guest_usage`** (ip_hash, month_key, clips, games)
- RLS owner-scoped everywhere; verified by live attack test. `free_plan_one_team` restrictive policy caps free users at one team.
- Buckets: `game-frames` (private, deleted after job), `game-thumbnails` (public, UUID names).

---

## Stripe

**Code is complete and best-practices reviewed.** Checkout uses session identity, dynamic payment methods, `integration_identifier`; webhook is signature-verified with a metadata fallback so a paying customer always gets Pro; Customer Portal wired for self-serve cancel/card updates (Settings → Manage subscription).

**Status: SANDBOX ONLY — cannot collect real money.** Test keys (`sk_test_`), sandbox product, sandbox webhook. Live activation was started (Individual / no EIN / SaaS tax code) but not finished.

**To go live:** complete Stripe activation (identity + bank), recreate product + webhook in live mode, swap `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` / `STRIPE_WEBHOOK_SECRET` in Vercel, redeploy.
**Sales tax:** not collected. Fine at current scale; revisit if revenue grows.

---

## Real usage data (queried 2026-09)

**33 signed up · 6 ever analyzed · 14 analyses total · 1 returned on a second day.**
13 of 14 were clips; games had **one** lifetime use — because game mode was unreachable (see below).

**The honest read:** this is an activation problem, not a retention problem. 27 of 33 made an account and never used the product. `reviews` only records successes, so **every failure is invisible** — we are blind to how many people tried and failed.

---

## Bugs found and fixed this session (context for why things look the way they do)

1. **Game reports analyzed as single clips.** YouTube's metadata API returns no duration (verified on two real links), so `(duration ?? 0) > 120` was always false — every link became a clip. The "Team game footage" toggle the user set was never sent to the route. **This is why "only 9 possessions" persisted through several earlier fixes: the windowed path never ran on real footage.**
2. **One call for a whole game** using a segment-scoped prompt → model summarized 40 min into a few highlights.
3. **"Grade the most significant ones"** was literally in the clip prompt.
4. **Cards grouped by team** in the UI, scrambling chronological order.
5. **Individual possessions discarded** after tallying — only counts survived.
6. **Clip uploads >4.5MB silently rejected** by Vercel; user saw "check your connection". Frames now 1152×648 q0.7 with a budget thin.
7. **Jersey misreads** (6→8, 26→25): video was being sent at default resolution; no roster constraint.
8. **Owner bypass never worked** — code read `OWNER_USER_IDS`, Vercel had `OWNER_USER_ID`.
9. **Landing redesign deleted** by `git add -A` sweeping a pre-existing working-tree revert.
10. **App rendered in Arial** — `body{font-family:Arial}` overrode the loaded Geist/Archivo.

---

## Open / next

**Blocked on user (highest value):**
1. **Re-run a full game with "Team game footage" selected.** The windowed path has *never* successfully executed on their footage. Every density fix is unverified in production. This is the single most important test.
2. **Fill in team rosters** (jersey numbers) — the roster constraint is the only near-airtight fix for misreads, and it's inert without data.
3. **Restore local Supabase keys.** `.env.local` is missing `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (lost to a VS Code overwrite), so `next dev` 500s and **everything must be verified against production** — slow. Copy from Supabase → Settings → API Keys, then:
   `printf "SUPABASE_SERVICE_ROLE_KEY=%s\n" "$(pbpaste)" >> .env.local`
4. Optionally set `AI_PROVIDER_GAMES=gemini` in Vercel (4× cheaper; link path already uses Gemini).

**Known-weak, needs real data to tune:**
- **Decision density.** ~5 events per 4-min window when the model demonstrably sees 18 possessions (verified by asking it to enumerate — it listed 18 with timestamps). Prompt is the bottleneck, not vision. Next levers: shrink windows 4min→2min, or raise fps.
- **Grade distribution** skewed to A's (8/11 in one run). Prompt now demands an honest spread; unverified.
- **Timestamp accuracy** — windows are clipped slices so the model's clock restarts at zero; it's told its absolute offset and asked to add it. **Never verified against real footage.** If Film Room jumps land on the wrong plays, this is why.

**Not built:**
- **Season stat ledger** — career/season totals, per-game averages, trends. This is the feature friends explicitly asked for. Stat events now carry timestamps and games actually reach the pipeline, so the groundwork is done.
- HoopIQ patterns worth stealing: **one insight with multiple clickable timestamp chips** (their "Asst. Coach" tab) — best idea there, shows patterns not isolated plays. Also team/player filters.
- Failure logging (we're blind to errors). Sample-clip demo so new users can try without having film handy.
- Inline correction of a wrong jersey number that sticks across a report.

**Hygiene:**
- 3 Inngest env vars still flagged "Needs Attention" in Vercel (plain-text, not Sensitive). Cosmetic; **a previous attempt to fix this deleted the production event key** — low value, high fumble risk.
- Rotate OpenAI key + GitHub token pasted into old chat logs.
- Set up `support@` / `privacy@getreel.org` inboxes (referenced in legal pages + support bot).
- Profile bar is chunky; two-column layout leaves dead space before first analysis.

---

## Dead ends (don't rebuild)

- **YouTube storyboard scraping** — returns 320×180 thumbnails, unusable for jersey numbers. Gemini native ingestion replaced it. The old `youtube-frames` route remains as a fallback.
- **yt-dlp + residential proxy** — unnecessary now that Gemini reads YouTube directly.
- Drill demo library, video hosting, age gate — all previously rejected.
- Strategy: Reel is **not** chasing HoopIQ on CV stats. Wedge = decision coaching + the drill loop (analyze → drill → record → form feedback). But **stats are table stakes** — users say the analysis is better but won't stay without them.
