# Virtual Wear — Lovable UI + Scale Assessment

**Date:** 2026-08-05  
**Project:** MyYanga v5 (`/Users/olufemiadeagbo/Downloads/myyanga-v5`)

---

## Honest scale / reliability verdict

**Verdict: Production-ready with caveats — not enterprise-scale proven.**

MyYanga Virtual Wear is **correctness-hardened** (paid pool, `imagesDiffer`, garment art, canvas fallback, PayGate, hostile audit PASS in mock tiers). That is **not** the same as proven throughput at thousands of concurrent users.

### AI path (Replicate → Gemini)

| Factor | Reality |
|--------|---------|
| **Latency** | Replicate IDM-VTON: ~15–90s per render (poll loop, 90s deadline). Gemini image: typically 5–20s but variable. |
| **Rate limits** | Replicate account tier + model queue; Gemini RPM/TPM per API key. No client-side queue — burst traffic hits 429/502. |
| **Cost per render** | Replicate IDM-VTON ≈ $0.02–0.08/run (model/version dependent). Gemini image ≈ $0.01–0.04/run. At 1,000 AI try-ons/day → roughly **$20–80/day** before Supabase egress. |
| **Reliability** | Cascade fails open to canvas. Without `REPLICATE_API_TOKEN` or `GOOGLE_API_KEY`, users get on-device preview only. |

### Canvas fallback (client-side)

| Factor | Reality |
|--------|---------|
| **Limits** | Runs in browser; large photos (>6MB) rejected at edge. Mobile low-end devices may stutter on 900px canvas. |
| **Scale** | Scales with users' devices — **no server cost**, but quality is overlay preview, not photorealistic. |
| **Guard** | `imagesDiffer()` prevents unchanged-photo regressions (verified in hostile audit). |

### Supabase edge (`virtual-tryon`)

| Factor | Reality |
|--------|---------|
| **Scaling** | Deno isolates per request; cold starts add 1–3s. Long Replicate polls hold the isolate ~60–90s — limits concurrent AI renders per project unless you add a job queue + webhook. |
| **Auth / pay** | `get_feature_gate(virtual_wear)` enforced server-side (402 if unpaid). |
| **Selfie** | `selfiePath` / `selfieUrl` / `personImage` resolved server-side (Lovable bug fixed). |

### Pay gate, pool rotation, guards

| Mechanism | Status |
|-----------|--------|
| **PayGate** | Client wrapper + server 402 on `virtual-tryon` |
| **Paid pool** | `creators.is_promoted` / `vw_pool_active` only |
| **No-repeat** | `localStorage` worn-outfit set per device (caps at 200 IDs) |
| **imagesDiffer** | Client rejects AI/canvas output matching input fingerprint |
| **garmentArt** | SVG overlays when DB rows lack images |

### What hostile audit proves vs what still needs load testing

**Proven (mock audit, 38/38 PASS):**

- Build succeeds
- Virtual wear node unit (garment art)
- Canvas compositing output ≠ input (browser runner)
- Route wiring, PayGate presence, pool module exports

**Not proven (needs load / soak testing):**

- 100+ simultaneous AI try-ons
- Replicate queue behaviour under burst
- Edge function timeout rates at p95
- Storage upload throughput for selfies
- Cost forecasting at marketing-scale traffic
- Live tier with real API keys + paid entitlements (Tier 3 skipped in last run)

### Gaps before claiming "reliable at scale"

1. **Job queue** for AI renders (async + polling UI) — avoid 90s edge holds
2. **Rate limiting** per user/device on try-on
3. **CDN caching** for garment assets
4. **Load test** virtual-tryon + storage at target concurrency
5. **Monitoring** on provider errors, latency p95, fallback rate

---

## Flow: before vs after

### Before (3-step wizard)

1. **Photo** — upload only  
2. **Theme & outfit type** — gender, event, single style → immediate random pick + render  
3. **Your look** — one outfit, try another rotates same brief  

No budget/vibe/modesty. No multi-option results. No Lovable landing/loading aesthetic.

### After (Lovable-style stage machine)

1. **Landing** — serif hero, ankara pattern, "Start styling"  
2. **Questionnaire** — selfie (moderated), gender, event type, vibes, budget, age group, modesty slider; profile pre-fill from `memberSettings` + Supabase `profiles`  
3. **Loading** — Sparkles + spinner, "Curating looks from our paying brands…"  
4. **Results** — up to **4 curated looks** from `vwPool` (paid brands only, **no `curate-looks` edge**); user picks one → **Try on me** → AI/canvas pipeline with `selfiePath`  

All MyYanga hardening retained: PayGate, `imagesDiffer`, `garmentArt`, `virtual-tryon`, canvas fallback, pool rotation.

---

## Lovable reference vs MyYanga implementation

| Lovable (reference `Index.tsx`) | MyYanga v5 |
|----------------------------------|------------|
| `curate-looks` edge (AI curation) | **Client `curateVwLooks()`** from paid garment pool |
| `selfiePath` not passed to edge (bug) | **Fixed** — `selfiePath` → `virtual-tryon` |
| 4 AI-generated look concepts | Up to 4 **real SKUs** from promoted brands |
| `moderateSelfie` | `moderateSelfie()` in `selfieUpload.js` (client heuristics) |
| Tailwind + lucide icons | MyYanga CSS tokens + inline SVG (`.ankara-pattern`, `.vw-lov-*`) |

---

## Files changed

| File | Change |
|------|--------|
| `src/pages/VirtualWearPage.jsx` | Lovable stage machine UI (landing → questionnaire → loading → results) |
| `src/lib/vwPool.js` | `VW_VIBE_OPTIONS`, `VW_AGE_GROUPS`, `curateVwLooks()`, budget/vibe/modesty filters |
| `src/lib/selfieUpload.js` | `moderateSelfie()`, `prepareSelfieForTryOn(existingPath)` |
| `src/lib/virtualWear.js` | Pass `selfiePath` through `renderLook` / `aiTryOn` |
| `src/myyanga-app.jsx` | Lovable aesthetic CSS (ankara pattern, chips, loading, results grid) |
| `docs/VIRTUAL-WEAR-LOVABLE-UI.md` | This document |

---

## Verification

```bash
cd ~/Downloads/myyanga-v5
npm run test:virtual-wear -- --node-only
npm run audit:hostile:mock-only
```

Run full browser canvas proof (optional):

```bash
npm run test:virtual-wear
```
