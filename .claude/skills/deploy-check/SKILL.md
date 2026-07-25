---
name: deploy-check
description: Verify the production Reel deployment on getreel.org is healthy after a push to main. Use after every git push, when the user asks "is the site up / did the deploy work," or before calling any shipped work done.
---

Verify the live production deployment of Reel. Vercel auto-deploys `main`; a build takes ~1–2 minutes after push, so if a check looks stale, wait (background `sleep 75`, not foreground) and retry — up to 3 attempts total before declaring failure.

Run these checks with Bash (all read-only; never skip one silently):

1. **Site up + SSL**: `curl -sS -o /dev/null -w "%{http_code}" -m 15 https://www.getreel.org` → must be `200`.
2. **Right content**: `curl -s -m 15 https://www.getreel.org | grep -io "<title>[^<]*</title>"` → must contain "Reel". If a recently pushed change altered visible text/meta, grep for a distinctive new string to confirm the new build is actually live (not a stale cache).
3. **Inngest endpoint**: `curl -s -o /dev/null -w "%{http_code}" -m 15 https://www.getreel.org/api/inngest` → expect `401` (auth-protected = healthy). `500` means a broken signing key or crashed route — that's a failure.
4. **API sanity**: `curl -s -m 15 "https://www.getreel.org/api/usage"` → expect a `200` JSON body (no userId = default response), not a 500.
5. **SEO routes**: `curl -s -o /dev/null -w "%{http_code}" -m 15 https://www.getreel.org/sitemap.xml` and `/robots.txt` → both `200`.
6. **Apex redirect**: `curl -s -o /dev/null -w "%{http_code}" -m 15 -L https://getreel.org` → final `200`.

Then report a one-line verdict: **PASS** (all green) or **FAIL** with exactly which check failed, its actual output, and the most likely cause (build still in progress vs. real error). If a check fails after retries, look at the failing route's code before speculating.

Never mark work "done and deployed" on a failing check. Do not use browser tools for this — curl is sufficient and faster.
