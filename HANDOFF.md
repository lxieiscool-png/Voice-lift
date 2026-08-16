# Reel — Handoff Brief (current as of 2026-07-27)

AI sports-coaching web app. Upload film → AI grades decisions, coaches, and prescribes drills. Live, ~23 real users.

## Essentials
- **Project:** `/Users/lxiei/Decision IQ/decisioniq` — Next.js **16 / Turbopack**, Tailwind **v4** (CSS-first, no tailwind.config; theme tokens live in `app/globals.css`). **Non-standard build** — read `node_modules/next/dist/docs/` before touching framework conventions (per AGENTS.md).
- **Prod:** https://www.getreel.org (Vercel, auto-deploys on push to `main`). Domain is IONOS; DNS/SSL working.
- **Repo remote:** `github.com/lxieiscool-png/Voice-lift.git`.
- **Supabase** (one project, dev+prod): auth (Google OAuth), Postgres, Storage, RLS.

## Standing preferences (apply without re-asking)
- **Auto-deploy:** commit + push to `main` directly, no asking. Site auto-deploys.
- User is hands-on, non-technical-ish. Give **direct, honest technical assessments — push back on bad ideas.** They explicitly value this (killed a HoopIQ-clone idea, an age-gate idea, etc. on honest advice).
- **Guardrail — flag before touching:** Supabase auth flows, and billing/Stripe/usage-gate logic. Say so, don't silently edit.
- **Schema changes:** propose SQL, have the user run it in the Supabase SQL editor. Don't blind-execute DDL. If they re-run a whole block and hit "already exists", tell them to run only the new part.
- **Verify everything:** `npx tsc --noEmit -p .`, `npm run build`, and after every push run the **`/deploy-check`** skill (`.claude/skills/deploy-check`). It curls prod (site/inngest/usage/routes). Never call work "done" on a failing check.
- **Build gotcha:** Turbopack build **fails flakily** — if `npm run build` errors once, re-run before assuming it's your code. Do NOT pipe `npm run build` through `grep` (it masks the exit code — check exit status directly: `npm run build && echo OK || echo FAIL`).

## Strategy (settled this session — don't re-litigate)
Reel is **NOT trying to be HoopIQ.** HoopIQ = a real CV pipeline for stats/highlights; Reel loses that race. Reel's wedge = **AI decision-*coaching* and player development** (make players better), for the individual player, any sport. The differentiator is the loop: analyze film → per-player grade + drills → record yourself doing the drill → form feedback → repeat. Stats are supporting context, not the product.

## What Reel does now
- **DecisionIQ** (upload tab): upload a **clip** (<~60s) or **full game** (file or YouTube). File is the reliable/quality path.
- **Clip mode:** one deep AI pass → per-player **graded cards** (letter grade + What Happened / Decision Read / Best Alternative / etc.), each with **"Drills to improve"** and **"Check my drill"** buttons.
- **Game mode:** frames sampled → chunked into ~6-frame segments → each segment analyzed in parallel (logs events, stat events, one-line notes; **no per-player grades**) → one synthesis call writes the game report (overall grade + "Your Grade" + **Did Well / Work On** pros-cons + sections) → box score tallied in code from stat events.
- **CoachIQ** (3 tabs): **Ask Coach** (chat), **Build My Plan** (weekly solo plan), **Drill Check** (record a drill → form feedback; saves history to `drill_checks`; opt-in face blur).
- **Teams:** create team, roster, link games, season record. **Library:** past reviews grouped by team. **Support bot:** floating "?" widget (help using the app, ≠ CoachIQ).

## Plans / limits (server-enforced, verified working)
Free: **1 game + 2 clips/month.** Pro ($8/mo): **8 games + 100 clips/month.** Gate is server-side in `/api/jobs/start` (games) and `/api/analyze` mode=clip (clips); Pro is counted (was uncapped). Failed analyses **refund** the credit. IP rate-limiting on all AI routes (`app/lib/ratelimit.ts`, fail-open).

## Key files
- `app/lib/analysis/analyzeChunk.ts` — clip + game-segment prompts (grading rubric, direct tone, one-sentence fields, court-relative direction, uploader tracking, per-sport depth).
- `app/lib/analysis/synthesize.ts` — game report synthesis (evidence/tally-based grade, Did Well/Work On).
- `app/lib/analysis/parsers.ts` — `parsePlayerBlocks`, `parseGameReport`, `buildBoxScore`, `parseDrillFeedback`.
- `app/lib/analysis/analyzeDrill.ts` — drill form-check. `app/lib/faceBlur.ts` — BlazeFace via CDN, fail-closed.
- `app/lib/usage.ts` — usage gate + `refundUsage`. `app/lib/ratelimit.ts` — IP limiter. `app/lib/supabase/admin.ts` — service-role client (server only).
- `app/components/DecisionIQ.tsx` — huge: upload UI, PlayerCard, DrillsOverlay, GameResultsView, FilmLibrary.
- `app/components/CoachIQ.tsx`, `Teams.tsx`, `DrillCheck.tsx`, `SupportWidget.tsx`, `GameCards.tsx`, `ui/button.tsx`.
- API routes: `/api/analyze`, `/api/synthesize`, `/api/jobs/*` (Inngest game jobs), `/api/drill`, `/api/drill/howto`, `/api/drills`, `/api/coach`, `/api/plan`, `/api/support`, `/api/thumbnail`, `/api/youtube-frames`, `/api/stripe/*`, `/api/usage`.
- `app/lib/inngest/functions.ts` — background game job.
- Legal: `app/privacy`, `app/terms`, `app/accessibility` (+ footer links).

## Live DB schema notes
- `profiles`: id, name, sport, team, created_at, **is_pro, monthly_analyses, month_key, monthly_games, stripe_customer_id** (the last 5 were MISSING and silently broke billing+gating until added this session — if billing acts weird, re-check they exist).
- `reviews` (team_id, opponent_name, game_type, game_date, location, thumbnail_url), `teams`, `team_members`, `analysis_jobs`, `drill_checks`. All RLS-scoped to owner (verified by live attack test — anon can't read/write across users).
- Buckets: `game-frames` (private, deleted after job), `game-thumbnails` (**public**, unguessable UUID names). `game-videos` bucket was discussed but video hosting was NOT built.

## Security posture (audited + tested this session)
Data is locked down: RLS blocks cross-user reads/writes (tested with the public anon key against prod), `is_pro` not client-writable, no secrets in the browser bundle or git history, Stripe webhook signature-verified, service-role server-only. Rate limiting added. `npm audit` shows high CVEs in **build-time** deps (postcss) + **sharp** — not live hack vectors for Reel's usage; fix bumps Next a patch version, do it *with* the user (don't force blind).

## Decided / dead ends (don't rebuild)
- **YouTube ingestion is dead from Vercel's IPs** — verified: YouTube demands login ("confirm you're not a bot") on every channel (player API × 5 client disguises, watch page stripped, embed page). Games are **upload-only**. A multi-tier gauntlet remains in `youtube-frames/route.ts` as free future-proofing. If users truly need YouTube games, the agreed path is a worker + yt-dlp + residential proxy (~$10–15/mo) that downloads REAL video — not a storyboard proxy.
- **Drill demo library** — user rejected it.
- **Video hosting / clickable highlights** — deferred; upload-only decided.
- **Age gate / heavy COPPA flow** — rejected (loses users); 13+ minimum is stated in Terms, that's the posture.

## Open / next (nothing urgent)
1. **Per-player graded cards in GAME reports** — biggest feature gap. Games give overall grade + box score but no per-player coachable cards + drills (clips have them). User is interested. Contained: add a `=== PLAYER ===` section to synthesis, reuse the parser + PlayerCard.
2. **Face blur needs the user's visual verification** — it's opt-in/beta/fail-closed and functionally wired (CDN loads), but nobody's confirmed it actually covers faces on a real clip. Don't promise it to users until verified.
3. **Promo edit** — waiting on the user's footage. Storyboard locked: "I suck, man" (airball) → app analyzes → same-angle make → "we back" → getreel.org. Export vertical 9:16, NO music (they add trending sound in TikTok). I can cut it with ffmpeg once they drop files.
4. **The real validation** — user keeps not running a real clip/game through the pipeline to judge output quality. That's the highest-value thing they could do; every "does the tone/grade/phrasing read right" question needs it.
5. Nice-to-haves floated: Vercel Analytics (one toggle, gets visit data), a "was this helpful?" feedback thumb on reports, per-player game drills.
6. Hygiene: rotate the OpenAI key + GitHub token that were pasted into chat (not in code/git, just chat-log hygiene). Set up the `support@` / `privacy@getreel.org` inboxes (referenced in legal pages + support bot).

## Session credentials note
User has pasted real secrets into chat before (OpenAI key, GitHub PAT, Vercel bypass) — they're comfortable with it for local `.env.local` / dashboard use. Don't casually ask for secrets in a new session; explain why, get consent, write to `.env.local` or the relevant dashboard.

## MCP / tools
`shadcn-ui` MCP is connected (used for the Button primitive). `21st.dev Magic` MCP was discussed but never set up (needs an API key). A `deploy-check` skill exists and should be run after every push.
