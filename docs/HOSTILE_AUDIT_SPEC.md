# Hostile Audit Specification

Canonical script: `scripts/hostile-audit.mjs`  
Run: `npm run audit:hostile`

Report auto-generated at `docs/HOSTILE_AUDIT_REPORT.md` on every run.

**Prerequisites:** `npx playwright install chromium` (preferred for full browser UX). Fallback: `canvas` + `happy-dom` devDependencies run `scripts/hostile-dom-runner.mjs` automatically when Playwright/Chrome unavailable.

## Purpose

Mirror what a **real user** experiences — not just static source-string checks. The audit runs three tiers by default (each skippable via flags).

## Tiers

### Tier 1 — BUILD GATE (fast, no server)

| Check | What it proves |
|-------|----------------|
| `npm install` | Dependencies resolve |
| `npm run lint` | Lint passes (skipped if no lint script) |
| `npm run build` | Production Vite build succeeds |
| `006_seed_production.sql` | Seed garments lack `image` URLs; `garmentArt.js` `enrichGarmentImages()` documents runtime SVG fallback |
| `.env.example` | Documents `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `PUBLIC_APP_URL`, `VITE_GOOGLE_AUTH`, `SUPABASE_SERVICE_ROLE_KEY` |
| `verify:production` | Core production files and migrations present |
| `test-virtual-wear.mjs --node-only` | Garment art generates for imageless rows |
| `test-smart-search.mjs` | `matchGarment` filter logic (His/Hers, arrays, price bands) |
| smart-search edge source | `asStringArray` + `overlaps` for plural filter params |

### Tier 2 — MOCK / TESTING MODE (dev server + Playwright)

Requires: `npm run dev` on port 5173 (started automatically if not running).

Browser test order: **Playwright** → system **Chrome headless** → **Vite SSR + node-canvas** fallback (`scripts/hostile-dom-runner.mjs`). The DOM fallback proves canvas compositing and filter logic; auth modal checks use source wiring when Playwright is unavailable.

| Check | What it proves |
|-------|----------------|
| SPA routes HTTP 200 | `/`, `/?view=smart`, `/?view=virtualwear`, legal pages, PDP, blog article, `/look/…` fallback |
| Nav route table | All nav views wired in `myyanga-app.jsx` |
| Virtual Wear canvas | `compositeLook()` output fingerprint **differs** from input photo |
| Smart Search filters | His+Agbada and Hers+Ghana+bag return hits in testing mode (`MOCK_GARMENTS`) |
| Auth modal | Google button, WhatsApp option, email magic link button present |
| WhatsApp testing flow | Shows testing OTP; does **not** fake success without verification |
| Tester login | `tester@myyanga.test` / `Test2026!` creates `myyanga_test_session` |
| Admin studio | Reachable after tester login |

**Hard rule:** Tier 2 must pass for any SHIP verdict. Unchanged virtual-wear output = FAIL.

### Tier 3 — LIVE / PRODUCTION MODE (Supabase edge + optional deploy)

Requires env (`.env` or shell):

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Anon key for edge calls |
| `AUDIT_TEST_EMAIL` | Live sign-in (default: `tester@myyanga.test`) |
| `AUDIT_TEST_PASSWORD` | Live sign-in (default: `Test2026!`) |
| `LIVE_SITE_URL` | Optional Amplify/Netlify smoke test |
| `PUBLIC_APP_URL` | Fallback deployed URL if `LIVE_SITE_URL` unset |

| Check | What it proves |
|-------|----------------|
| `smart-search` no auth | Returns **401** |
| `virtual-tryon` no auth | Returns **401** |
| `auth-whatsapp` request | Returns **503** when Cloud API not configured (not fake `ok: true`) |
| Live session sign-in | Real Supabase password auth |
| `smart-search` arrays | `events[]` narrows results; `styles:[Agbada]` returns only Agbada (or empty) |
| `virtual-tryon` | Returns image **different** from input, OR honest **501/502** with `fallback: true` when no AI keys |
| Deployed URL | `LIVE_SITE_URL` returns 200 with MyYanga content |

**Pay gates (402):** If `get_feature_gate` denies access, array-filter and try-on tests are marked SKIPPED with a note — not a false PASS. Grant entitlements in Supabase to exercise full live paths.

## Verdict rules

| Verdict | Condition |
|---------|-----------|
| **FAIL** | Any Tier 1 or Tier 2 failure; or `--require-live` with Tier 3 skipped/failed |
| **PARTIAL** | Tier 1+2 pass; Tier 3 skipped or has failures |
| **PASS** | All executed tiers pass |

Never report PASS if virtual wear returns an unchanged image.  
Never report PASS if smart-search ignores filter arrays in the production path.

## npm scripts

```bash
npm run audit:hostile              # all tiers (live skipped without creds)
npm run audit:hostile:mock-only    # tier 1 + 2 only
npm run audit:hostile:live         # fails if live tier cannot run
```

Flags: `--tier1-only`, `--skip-install`, `--force-mock`, `--force-live`

## Honest limitations (cannot automate today)

- **Real Google OAuth click** — browser redirect to Google; testing mode fakes founding-admin Google sign-in locally only. When Playwright is unavailable, auth UI is verified via source wiring + `authenticateTester()`.
- **Real WhatsApp SMS delivery** — Meta Cloud API must be configured; audit checks 503 honesty, not message delivery.
- **Real email magic link inbox** — testing mode auto-signs-in; production requires email provider.
- **Payment provider checkout** — Flutterwave/Paystack/Stripe live charges not exercised.
- **Mobile device UX** — desktop Playwright only; no real iOS/Android tap targets.
- **Amplify env vars** — deployed build may differ from local `.env`; use `LIVE_SITE_URL` for smoke only.

## Superseded

`scripts/aggressive-audit.mjs` — deprecated; forwards to hostile audit Tier 1 only with a warning.
