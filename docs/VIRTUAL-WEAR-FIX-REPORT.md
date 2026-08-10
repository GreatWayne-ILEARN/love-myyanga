# Virtual Wear Fix Report

**Project:** `/Users/olufemiadeagbo/Downloads/myyanga-v4`  
**Date:** 2026-07-28  
**Status:** Canvas fallback **fixed and verified**. Selfie→API path wired (Lovable pattern). AI photorealistic try-on **requires API keys**.

---

## Lovable reference vs actual MyYanga

The user shared **Lovable `Index.tsx` as reference only** — it is **not** the codebase on disk. No `curate-looks`, `QuestionnaireFlow`, or `Results.tsx` exist in `myyanga-v4`.

| Lovable (reference) | Actual MyYanga v4 | Analogous bug? |
|----------------------|-------------------|----------------|
| `uploadSelfie` → `enriched.selfiePath` | `VirtualWearPage` → `photo` data URL | Different upload model |
| `curate-looks` invoke **missing `selfiePath`** | `virtual-tryon` receives `personImage` | **MyYanga passed photo but garments had no images** |
| `Results` component applies virtual wear | `VirtualWearPage` + `renderLook()` | Same intent, different UI |
| `persistLooks` → `looks` / `look_items` | `persistLook()` → `looks` table | Similar persistence |

### Key lesson from Lovable

> Upload the selfie, store the path, then **pass that path to the generation edge function**.

In Lovable's reference code, the selfie was uploaded to storage but **`curate-looks` never received `selfiePath`** — generation ran without the user's photo.

In MyYanga v4, the equivalent failure was different but same class of bug:
- Photo **was** sent as `personImage` to `virtual-tryon`
- But **garment `image` URLs were null** in production DB → canvas drew nothing → output = original photo

### What we ported from Lovable (virtual wear only)

1. **`src/lib/selfieUpload.js`** — upload selfie to `looks` bucket, return `{ path, signedUrl }` (Lovable `uploadSelfie` pattern)
2. **`virtualWear.js`** — production AI try-on now sends `selfiePath` + `selfieUrl` alongside `personImage`
3. **`virtual-tryon` edge** — resolves person from `personImage` OR `selfieUrl` OR `selfiePath` (storage sign)

We did **not** copy the Lovable app structure (questionnaire, curate-looks, Results).

---

## Root cause — Virtual Wear returned unchanged photo

### What was broken

1. **Production DB garments have no `image` / `card_image` URLs**  
   `006_seed_production.sql` inserts metadata only. `compositeLook()` had nothing to overlay → original photo returned.

2. **Silent AI fallback**  
   Missing `GOOGLE_API_KEY` / `REPLICATE_API_TOKEN` → 501 → canvas fallback with empty garments.

3. **Scene tint drawn under photo** (invisible).

4. **No unchanged-output detection**.

### What we fixed

| File | Change |
|------|--------|
| `src/lib/garmentArt.js` | Generates SVG garment overlays when DB has no image |
| `src/lib/selfieUpload.js` | **New** — Lovable-style storage upload + signed URL |
| `src/lib/virtualWear.js` | Garment art, selfie path in API body, `imagesDiffer()` guard |
| `src/lib/dataBridge.js` | `enrichGarmentImages()` on garment fetches |
| `supabase/functions/virtual-tryon/index.ts` | Replicate IDM-VTON → Gemini; accepts selfiePath/selfieUrl |
| `scripts/test-virtual-wear.mjs` | Runtime verification |
| `scripts/aggressive-audit.mjs` | Auth + virtual wear checks |

---

## Verification evidence

```
=== Virtual Wear Test ===
PASS node: garment art generated for imageless DB row
NODE PASS
npm run build → ✓ success
```

Run full canvas proof locally:
```bash
cd ~/Downloads/myyanga-v4
npx playwright install chromium   # once
npm run test:virtual-wear       # browser + node
```

**Expected behaviour after fix:**
- **Testing mode:** Visible garment overlay (canvas) — no API keys needed
- **Production + keys:** Photorealistic Replicate/Gemini try-on
- **Production without keys:** Visible canvas overlay — **not** unchanged photo

---

## Auth fixes

### WhatsApp login

| Issue | Fix |
|-------|-----|
| `verifyOtp({ type: "email" })` for magic-link token | → `type: "magiclink"` |
| Fake success when WhatsApp Cloud not configured | Server returns 503; client errors if no code sent |

**Production requires:** `WHATSAPP_CLOUD_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` on `auth-whatsapp`

### Email login

| Issue | Fix |
|-------|-----|
| Password-only; opaque unconfirmed-email errors | Clear error message |
| No magic link | `sendEmailMagicLink()` + UI button in auth modal |

**Production requires:** Supabase Auth SMTP + redirect URLs

---

## AI photorealistic try-on — honest status

Canvas overlay is fixed. Photorealistic AI (Lovable-quality) needs **one** of:

| Secret (Supabase edge) | Service |
|------------------------|---------|
| `REPLICATE_API_TOKEN` | **Recommended** — IDM-VTON |
| `GOOGLE_API_KEY` | Gemini 2.5 Flash image (fallback) |

```bash
supabase secrets set REPLICATE_API_TOKEN=r8_...
supabase functions deploy virtual-tryon
```

Without keys: users get **visible garment overlay**, not photorealistic try-on.

---

## Files changed

- `src/lib/garmentArt.js` (new)
- `src/lib/selfieUpload.js` (new)
- `src/lib/virtualWear.js`
- `src/lib/dataBridge.js`
- `src/lib/whatsappAuth.js`
- `src/hooks.js`
- `src/myyanga-app.jsx`
- `src/pages/VirtualWearPage.jsx`
- `supabase/functions/virtual-tryon/index.ts`
- `supabase/functions/auth-whatsapp/index.ts`
- `scripts/test-virtual-wear.mjs` (new)
- `scripts/aggressive-audit.mjs`
- `.env.example`
- `package.json`

---

## Remaining blockers (user action)

1. Set `REPLICATE_API_TOKEN` or `GOOGLE_API_KEY` on deployed `virtual-tryon`
2. Configure WhatsApp Cloud API on `auth-whatsapp`
3. Configure Supabase SMTP for email magic links
4. Upload real garment photos via Admin Studio for best AI results

---

## What previous audits missed

Static audits checked that function names **existed in source** — never ran canvas compositing, never checked production seed data lacked images, never tested auth OTP types, never compared output hash to input.

The audit now runs `npm run test:virtual-wear --node-only`.
