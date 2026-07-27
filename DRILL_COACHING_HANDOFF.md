# Reel — Drill Coaching Handoff (for the next chat)

You are continuing work on **Reel** (aka Decision IQ), an AI sports-coaching app. This brief is focused on **the drill-coaching feature** — the strategic direction we committed to. Read it fully before writing code.

## Project facts
- Repo: `/Users/lxiei/Decision IQ/decisioniq`. Remote: `github.com/lxieiscool-png/Voice-lift.git`.
- Production: https://www.getreel.org — Vercel, auto-deploys on push to `main`.
- **Next.js 16 / Turbopack + Tailwind v4 (CSS-first, no tailwind.config).** Non-standard — read `node_modules/next/dist/docs/` before touching framework conventions (per AGENTS.md).

## Standing user preferences (apply without re-asking)
- **Auto-deploy**: commit and push straight to `main`, no asking. Site auto-deploys.
- User is hands-on, non-technical-ish. Give **direct, honest technical assessments — challenge bad ideas, don't cheerlead.** This is explicit and important; they value pushback.
- **Never touch Supabase auth or billing/Stripe/usage-gate logic without flagging first.** (Usage caps were reworked this session — see below — but still flag before changing them.)
- Schema changes: propose SQL, have them run it in the Supabase SQL editor. Don't blind-execute DDL.
- Verify: `npx tsc --noEmit -p .`, `npm run build`, live check where possible before calling done. Note: a second `next dev` won't run while another holds port 3000, and signed-in views need auth — so a lot can't be previewed locally; the user tests on the deployed site.

## The strategic why (don't lose this)
Reel will **not** chase HoopIQ (a better-funded competitor with a real CV stats pipeline). On stats/tracking/highlights, HoopIQ wins. Reel's wedge is **coaching that makes players better**, not measurement. The customer is **the individual player who wants to improve on their own** — the kid in the driveway, not the coach who wants a box score. HoopIQ doesn't serve that person.

**The wedge is the drill-coaching loop:** analyze game → get a prescribed solo drill → *player records themselves doing it* → AI gives form feedback → they improve → repeat. That loop is the retention engine (a reason to come back), it's cheap, and — critically — a single close-up player doing a drill is the *easiest* input for the vision model (opposite of wide, chaotic game footage), so accuracy is genuinely good here.

## What's already built (the Drill Check MVP — shipped this session)
- `app/lib/analysis/analyzeDrill.ts` — `analyzeDrill({ drill, frames, sport })`. Has a precheck ("is this actually someone doing a drill?"), then evaluates execution **against the prescribed drill**. Output format: `Verdict / Did Well / Main Fix / Focus Next`, single sentences. Honest scope: **gross-form check, not biomechanics.** Avoids left/right (mirror-unreliable).
- `DrillFeedback` type in `app/lib/types.ts`; `parseDrillFeedback` in `app/lib/analysis/parsers.ts`.
- `app/api/drill/route.ts` — POST `{ drill, frames, sport, userId }`. Metered as a **clip** (cheap) for signed-in users via `checkAndIncrementUsage`; guests exempt.
- `app/components/DrillCheck.tsx` — the UI: drill description textarea + clip upload → samples ~18 frames client-side → calls `/api/drill` → renders verdict/didWell/mainFix/focusNext. Accepts an `initialDrill` prop (currently unused — see next steps).
- Lives as the third tab **inside CoachIQ** (`app/components/CoachIQ.tsx`, tab id `"drill"`, labeled "Drill Check") — not a top-level module. CoachIQ takes a `userId` prop and passes it through.

**Status: prototype, unvalidated on real footage.** The first real drill clip the user runs IS the accuracy test. Before building more on top, confirm the feedback is specific and correct, not generic. If mediocre, tune the `analyzeDrill` prompt first.

## Next steps for drill coaching (in order)
1. ~~**AI how-to text.**~~ **DONE** — `/api/drill/howto` (text-only, unmetered like coach chat) returns Setup/Steps/Common Mistakes/Cue; "Show me how to do it" button in DrillCheck.
2. ~~**Close the loop.**~~ **DONE** — "Check my drill" buttons on `PlayerCard`'s Practice Focus and `GameResultsView`'s Practice This Week hand the drill to CoachIQ's Drill Check tab via `openDrillCheck()` / `takeDrillPrefill()` in `decisioniq-helpers.ts` (localStorage `reel-drill-prefill` + `reel-open-drill-check` event; page.tsx switches module, CoachIQ picks up + remounts DrillCheck keyed on the prefill). **Not yet done from this item:** persisting drill-check results linked to the source review so a player sees progress over time (store in `review.data` — no DDL, same pattern as `boxScore`).
3. **Demo videos (v2, do with care).** Pulling arbitrary YouTube demos for a *custom* AI drill is unreliable (wrong/low-quality/inappropriate videos erode trust). Prefer a small **curated** map of common drill types → vetted demos, or a clearly-labeled best-effort search. Not a day-one promise.
4. **Behavior/retention test.** The real risk isn't prompt quality — it's whether kids will actually record themselves. Test cheaply, don't over-invest before there's a signal.

## Honest caveats to preserve in the product
- Drill feedback is a **form check** (base too narrow, rushing reps, no follow-through), **not** exact biomechanics. Don't let the UI over-promise.
- Vision models flip **left/right** constantly (mirroring/perspective). Prompts now steer toward court-relative / hand-relative terms; keep that.

## Privacy roadmap (users are actively asking; treat as high priority)
Real users report being privacy-anxious and have asked to **blur their faces**. Verified facts about current film handling: the raw video file never leaves the browser (frames extracted via canvas); game frames go to a PRIVATE `game-frames` bucket and are deleted on success AND failure; clip frames are never stored; frames are sent to OpenAI to analyze (unavoidable); ONE low-res thumbnail per game persists in a PUBLIC `game-thumbnails` bucket (unguessable UUID filename, but world-readable by URL and not deleted). RLS verified blocking all cross-user access.

Two builds, both need visual testing (do NOT ship blind — a false privacy promise is worse than none):
1. **Face blur (top ask).** Detect + blur faces client-side on each frame BEFORE it's sent, so unblurred faces never leave the device (AI, storage, thumbnail all get blurred frames). Use a lightweight in-browser model (BlazeFace/MediaPipe). Make it an OPT-IN toggle, framed BEST-EFFORT: reliable on close-up drill clips, unreliable on wide game footage (distant faces too small to detect — same resolution ceiling as everything else). Doesn't hurt analysis (grading uses body/jersey/ball, not faces). If face blur ships, it largely obviates #2.
2. **Private thumbnails (deferred).** Make `game-thumbnails` bucket private + serve via time-limited signed URLs so the one persisted still isn't world-readable. Touches: thumbnail route (store path not public URL), how `thumbnailUrl` is saved in `review.data`, and Library rendering (generate signed URLs); handle existing already-public URLs. Held because it can silently break every Library image if done without visual verification.

## Other state from this session (context, not the focus)
- **YouTube ingestion is effectively dead — decided, don't re-litigate.** Verified via live diagnostics: YouTube demands sign-in ("confirm you're not a bot") from Vercel's IPs on every channel (player API under 5 client disguises, watch page with player data stripped, embed page). Even when it worked, storyboard tiles are ~160×90–320×180 — jersey numbers unreadable, analysis-of-blurs. Decision: games are upload-only (UI already warns + offers one-tap switch to file upload; a multi-client gauntlet remains in `app/api/youtube-frames/route.ts` as free future-proofing). If real users repeatedly can't get YouTube-only games, the agreed upgrade is a small worker + yt-dlp + residential proxy (~$10–15/mo) that downloads real video for full-quality frames — NOT a storyboard proxy (rejected: pays to restore blurs).
- **Cost controls (billing area — flag before changing):** usage is now server-enforced and split by kind. Games: free 1/mo, Pro 8/mo. Clips: free 2/mo, Pro 100/mo. Pro is now *capped* (was unlimited — the bankruptcy hole). Logic in `app/lib/usage.ts`, enforced in `/api/jobs/start` (games) and `/api/analyze` mode=clip (clips). Client pre-checks via `GET /api/usage?userId=&kind=`, fails open on error.
- **Film analysis cost:** deep game path trimmed to 240 frames (~$0.70/game) with motion filtering. Cheaper levers if needed: trim further, or A/B a mini model (would hurt jersey reads — test first).
- **Auto box score:** games now emit a per-player box score (`buildBoxScore` tallies "Stat Events" lines deterministically). Labeled an AI estimate; weak on fast events. This is *supporting context*, not the product.
- **Light/dark mode:** the whole app was migrated to shadcn-style **semantic tokens** (`bg-card`, `text-muted-foreground`, `border-border`, `bg-primary`, etc.) in `app/globals.css`, with a `ThemeToggle` in the nav (defaults dark, persists to `localStorage` key `reel-theme`). **Build new UI with tokens, not hardcoded `zinc-*`/`black`/`white`.** May still have missed spots — user is reviewing.
- **shadcn:** the `Jpisnice/shadcn-ui-mcp-server` MCP is connected (adds `mcp__shadcn-ui__*` tools — pull real component source via `get_component`). No shadcn/CVA/Radix deps installed. There's a dependency-free adapted **`app/components/ui/button.tsx`** (`<Button variant size>`) and a minimal `cn` in `app/lib/utils.ts`. Prefer `<Button>` for new buttons. The 21st.dev Magic MCP is NOT set up (needs its API key).

## Key files
- `app/lib/analysis/analyzeDrill.ts`, `app/api/drill/route.ts`, `app/components/DrillCheck.tsx` — the drill feature.
- `app/lib/analysis/{analyzeChunk,synthesize,parsers}.ts` — shared game/clip analysis + parsing.
- `app/components/DecisionIQ.tsx` — huge: upload UI, `FilmLibrary`, `PlayerCard`, `GameResultsView` (has the `practiceFocus` drill to hook step 2 onto).
- `app/lib/usage.ts` — usage gate. `app/globals.css` — theme tokens. `app/components/ui/button.tsx` — Button primitive.
