# MyYangaX

**Release date:** 2026-08-05 (staging) · prior: 2026-07-28  
**Package:** `MyYangaX` · **semver:** 5.0.0 · **codebase:** `myyanga-v5`

## Summary

**MyYangaX** is the branded staging handoff for MyYanga v5 — pre-production after hostile audit hardening, local Supabase testing, and fixes across Virtual Wear, Smart Search, reel delivery, and authentication. **Aug 2026** adds the Lovable Virtual Wear UI integration.

## Lovable Virtual Wear UI (2026-08-05)

- Lovable-style stage machine: landing → questionnaire → loading → results grid (up to 4 curated looks).
- Client `curateVwLooks()` from paid brand pool (`vwPool.js`) — no `curate-looks` edge.
- Selfie moderation (`moderateSelfie`) and `selfiePath` passed through to `virtual-tryon`.
- Budget, vibe, modesty, and age-group filters; ankara-pattern Lovable aesthetic in `myyanga-app.jsx`.
- Hostile audit mock tier: **38/38 PASS** after integration.
- See `docs/VIRTUAL-WEAR-LOVABLE-UI.md`.

## Changes in v5 (from v4)

### Hostile audit (3-tier)

- Tiered hostile audit pipeline (`audit:hostile`, `audit:hostile:mock-only`, `audit:hostile:live`) with mock and live Supabase paths.
- Aggressive audit gate (`audit:aggressive`) for ship readiness.

### Supabase Tester

- Local `supabase-tester` service and `dev:tester` workflow for Production mode without cloud Supabase.
- QA scripts and docs (`SUPABASE_TESTER.md`, `test-supabase-tester.mjs`).

### Virtual wear fix

- Virtual try-on / Virtual Wear flow fixes (paid brand pool, no premature outfit repeat).
- See `docs/VIRTUAL-WEAR-FIX-REPORT.md`.

### SmartSearch fix

- Multi-parameter Smart Search narrowing (His/Hers, country, event, style, colour, piece, price).
- See `docs/SMART-SEARCH-FIX-REPORT.md`.

### Reel delivery scheduler fix

- Member reel schedule in Settings aligned with delivery engine and scheduler.
- See `docs/REEL-DELIVERY-FIX-REPORT.md`.

### Auth fixes (WhatsApp, email magic link)

- WhatsApp OTP via Meta Cloud API (no BSP).
- Email magic link / tertiary auth path corrections.

## Docs

- Capabilities: `docs/MYYANGA_V5_CAPABILITIES.md`
- AWS restage: `docs/AWS_RESTAGE.md`
- Virtual Wear Lovable UI: `docs/VIRTUAL-WEAR-LOVABLE-UI.md`
- Staging zip: `~/Downloads/MyYangaX.zip`
- Staging readme: `MYANGAX_STAGING_README.md`

## v4

`myyanga-v4` remains in `~/Downloads/myyanga-v4` (not removed).
