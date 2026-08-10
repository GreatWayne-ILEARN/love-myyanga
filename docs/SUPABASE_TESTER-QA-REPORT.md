# Supabase Tester QA Report

**Project:** `/Users/olufemiadeagbo/Downloads/myyanga-v4`  
**Date:** 2026-07-28  
**Session:** Resumed a5dc03ca — Supabase Tester built and QA’d

---

## Summary

| Item | Result |
|------|--------|
| Supabase Tester implementation | **Complete** (`supabase-tester/`) |
| `npm run test:supabase-tester` | **12/12 PASS** |
| Hostile audit Tier 3 (local tester) | **PASS** (9/9 live checks) |
| Full hostile audit (Tier 1–3) | **VERDICT: PASS** |
| Staging zip | `~/Downloads/myyanga-v4-staging.zip` |

---

## Issues found and fixes

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 1 | **Supabase Tester missing** — prior session work not on disk | Blocker | Built full `supabase-tester/` server (auth, REST, storage, edge functions) |
| 2 | **`req.json()` / `req.headers.get()` on Node `http.IncomingMessage`** | Blocker | Added `readBody()` / `readBodyBuffer()` and plain-object header access in handlers |
| 3 | **Port 54321 EADDRINUSE** — stale process / Supabase CLI conflict | High | Default port changed to **54322**; documented in `SUPABASE_TESTER.md` |
| 4 | **Hostile audit Tier 3 skipped without cloud `.env`** | Medium | `hostile-audit.mjs` loads `.env.supabase-tester`; `USE_SUPABASE_TESTER=1`; tester URL detection |
| 5 | **auth-whatsapp audit expected 503 OR exposed OTP** | Low | Tester returns `200 + code` when `WA_AUTH_EXPOSE_OTP=1`; audit accepts for `isTester` |
| 6 | **No `npm run dev:tester` / `supabase-tester:start`** | Medium | Added scripts + `scripts/dev-with-tester.mjs` |
| 7 | **PostgREST filter format** (`is_active=eq.true`) | Medium | Rewrote `applyFilters()` for `eq.`, `gte.`, `lte.`, `cs.{}` |

No app source changes required for Production mode against tester — existing `supabase.js`, `virtualWear.js`, `smartSearch.js`, and `whatsappAuth.js` work with tester URLs.

---

## Production mode test matrix (against tester)

| Flow | Status | Notes |
|------|--------|-------|
| Password login | PASS | `tester@myyanga.test` |
| `get_feature_gate` | PASS | `access: true` (tester default) |
| Garments CRUD read | PASS | 13 seeded rows |
| Smart search edge | PASS | Array filters narrow results |
| Virtual try-on edge | PASS | Mock image differs from input |
| Storage selfie upload | PASS | `looks` bucket |
| WhatsApp OTP request | PASS | Code exposed in JSON |
| WhatsApp verify → session | PASS | `token_hash` + `verifyOtp` |
| Payments checkout | N/A | Returns 503 for paid init (documented gap) |

---

## Hostile audit results (with tester)

```
Tier 1 BUILD: 9 pass, 0 fail
Tier 2 MOCK:  29 pass, 0 fail
Tier 3 LIVE:  9 pass, 0 fail
VERDICT: PASS
```

Command:

```bash
USE_SUPABASE_TESTER=1 npm run audit:hostile
```

Tier 3 runs against `http://127.0.0.1:54322` (not cloud Supabase).

---

## Lovable: Replicate vs Google Gemini for virtual wear?

**Answer: Both — Replicate is primary, Gemini is fallback. Lovable reference used neither directly in this repo.**

### Evidence

1. **`supabase/functions/virtual-tryon/index.ts`** (current production edge):
   - Header comment: *"Provider cascade: Replicate IDM-VTON → Gemini image edit."*
   - `replicateTryOn()` runs first when `REPLICATE_API_TOKEN` is set (IDM-VTON model).
   - `geminiTryOn()` runs second when `GOOGLE_API_KEY` is set (`gemini-2.5-flash-image`).
   - Returns `provider: "replicate-idm-vton"` or `"gemini-2.5-flash-image"`.

2. **`docs/VIRTUAL-WEAR-FIX-REPORT.md`**:
   - Documents Lovable **reference** (`Index.tsx`) as inspiration for selfie path wiring only.
   - States photorealistic AI needs `REPLICATE_API_TOKEN` (**recommended**) or `GOOGLE_API_KEY` (**fallback**).
   - Lovable’s `curate-looks` function was **not** ported; MyYanga uses `virtual-tryon`.

3. **Git history**: Repository has no git remote/history in this environment; commit lineage for virtual-tryon could not be queried. Source-of-truth is the edge function above.

4. **Client fallback**: `src/lib/virtualWear.js` — AI edge first, then on-device **canvas** compositing (no third-party API).

### Conclusion

| Layer | Provider |
|-------|----------|
| Server AI (preferred) | **Replicate** IDM-VTON |
| Server AI (fallback) | **Google Gemini** 2.5 Flash Image |
| Client fallback | Canvas overlay (`compositeLook`) |
| Supabase Tester | Deterministic mock (`supabase-tester-mock`) |

Lovable’s reference app did not dictate Replicate vs Gemini for MyYanga; the MyYanga team implemented a **Replicate-first, Gemini-second** cascade in `virtual-tryon`.

---

## Files created / modified

**Created:**
- `supabase-tester/` (server, db, auth, REST, storage, functions)
- `.env.supabase-tester`
- `scripts/dev-with-tester.mjs`
- `scripts/test-supabase-tester.mjs`
- `docs/SUPABASE_TESTER.md`
- `docs/AWS_RESTAGE.md`
- `docs/SUPABASE_TESTER-QA-REPORT.md` (this file)

**Modified:**
- `package.json` — `supabase-tester:start`, `dev:tester`, `test:supabase-tester`
- `scripts/hostile-audit.mjs` — tester env + Tier 3 localhost support

---

## How to reproduce

```bash
cd ~/Downloads/myyanga-v4
npm run supabase-tester:start          # :54322
npm run test:supabase-tester           # 12 smoke checks
USE_SUPABASE_TESTER=1 npm run audit:hostile
npm run dev:tester                     # app in Production mode
```
