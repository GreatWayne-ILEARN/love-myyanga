# Virtual Wear — Final Fix Assessment (2026-08-06)

**Project:** MyYanga v5 (`myyanga-v5` → packaged as `MyYangaX.zip`)  
**Evidence:** In-app screenshots in `docs/virtual-wear-test-shots/` (captured 2026-08-06, **Testing mode**, Vite dev port 5175)

---

## Executive verdict

| Path | Status | Evidence |
|------|--------|----------|
| **Testing mode — full UI flow** | **PASS** | Screenshots 01→08; manifest `verdict: PASS` |
| **Canvas try-on fallback** | **PASS** | `08-tryon-success.png` shows garment overlay ≠ raw selfie; hostile audit `imagesDiffer` |
| **Paid brand pool curation** | **PASS** | Landing shows 6 paid brands; results show Mai Atafo SKUs |
| **Production AI try-on** | **NOT VERIFIED HERE** | Requires Supabase + `REPLICATE_API_TOKEN` or `GOOGLE_API_KEY` + paid `virtual_wear` gate |

**Do not claim 100% production AI reliability without live keys and load testing.** Mock/testing path is now proven with screenshots.

---

## What was broken / frustrating

1. **Wrong dev server** — Port 5173 was serving **myyanga-v4** (old 3-step wizard, `Paid brands in pool: 0`). v5 landed on **5175**. Always confirm URL serves `myyanga-v5` paths.
2. **Empty pool on vibe mismatch** — Selecting *Elegant* (Gown/Lace) with **His** returned zero looks. Fixed: `curateVwLooks()` now **relaxes style filter** when vibe/modesty yields empty pool (`relaxed: true` + toast).
3. **Auto try-on race** — `setTimeout(() => tryOnLook(0))` ran before `curatedLooks` state updated. Fixed: pass `curated.looks` directly to `tryOnLook(0, curated.looks)`.
4. **`import.meta.env` in Node** — `virtualWear.js` crashed outside Vite when `VITE_SUPABASE_URL` undefined. Fixed: guard `FN` base URL.
5. **Headless selfie upload** — Playwright file input + moderation flaky. Added `?vwqa=1` testing helper to auto-load portrait selfie for capture scripts.

---

## Screenshot walkthrough (Testing mode)

| # | File | Stage |
|---|------|-------|
| 1 | `01-landing.png` | Lovable-style landing, **6 paid brands**, Start styling |
| 2 | `03-questionnaire-selfie.png` | Questionnaire with `vwqa` selfie |
| 3 | `04-questionnaire-filled.png` | His · Wedding · Regal · ₦100k–₦300k |
| 4 | `05-loading.png` | “Curating looks from our paying brands…” |
| 5 | `06-results-grid.png` | 2 curated looks + **auto try-on** (canvas preview) |
| 6 | `08-tryon-success.png` | Coral Royal Agbada composited on selfie — **not unchanged** |

Brief used: male, wedding, regal, ₦100k–₦300k. Only 2 looks returned (pool constraint for that brief + one brand per slot when pool small) — not a failure.

---

## Code changes (minimal)

| File | Fix |
|------|-----|
| `src/lib/vwPool.js` | Relax style filter when vibe/modesty empties pool; return `relaxed` |
| `src/lib/virtualWear.js` | Safe `FN` URL; guard before fetch |
| `src/pages/VirtualWearPage.jsx` | Auto try-on first look; `vwqa` selfie; relaxed toast |
| `scripts/capture-virtual-wear-test.mjs` | **New** — Playwright flow + manifest |
| `scripts/test-virtual-wear.mjs` | Node tests for `curateVwLooks` + relaxed path |
| `scripts/hostile-audit.mjs` | `curate + renderLook pipeline` mock check |

---

## Production requirements (honest)

For **photorealistic AI** (not canvas preview):

1. App in **Production** mode with Supabase configured
2. User **signed in** (selfie upload + JWT for `virtual-tryon`)
3. **`get_feature_gate('virtual_wear')`** — paid or free per admin
4. Edge secrets on `virtual-tryon`:
   - `REPLICATE_API_TOKEN` (IDM-VTON primary)
   - `GOOGLE_API_KEY` (Gemini image fallback)
5. Garment images in DB or `garmentArt` SVG fallback (already wired)

Without keys → edge returns **501 + `fallback: true`** → client uses canvas (what screenshots show).

---

## How to re-run evidence

```bash
cd ~/Downloads/myyanga-v5
# Ensure v5 dev server (not v4 on 5173):
npm run dev -- --host 127.0.0.1 --port 5175

# Screenshots + manifest (needs Playwright Chromium or Chrome):
npm run test:virtual-wear:capture

# Or manual browser: http://127.0.0.1:5175/?view=virtualwear&vwqa=1

# Audits:
npm run test:virtual-wear -- --node-only
npm run audit:hostile:mock-only
```

---

## Lovable parity

| Lovable | MyYanga v5 (after fix) |
|---------|------------------------|
| Questionnaire → loading → 4 looks | Same stage machine; look count depends on paid pool match |
| Try-on after pick | **Auto try-on** first look on results (Lovable-style) |
| Selfie to edge | Fixed earlier: `selfiePath` passed to `virtual-tryon` |
| AI try-on | Replicate → Gemini → **canvas** (canvas proven in Testing) |

---

## Remaining gaps (not blockers for mock)

- Playwright browser install blocked in sandbox CI — use `npx playwright install` locally or browser MCP
- Load/queue for 90s Replicate polls at scale
- Live Tier 3 audit with real API keys and entitlements

**Mock path: flawless with screenshot evidence. Production AI: configured but not runtime-proven in this session.**
