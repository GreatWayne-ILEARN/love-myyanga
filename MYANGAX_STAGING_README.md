# MyYangaX — Staging Handoff

**Date:** 2026-08-05 · **semver:** 5.0.0 · **Release:** MyYangaX (Lovable Virtual Wear UI)

## What's new

- Lovable-style Virtual Wear stage machine (landing → questionnaire → loading → results)
- Client-side `curateVwLooks()` from paid brand pool (no `curate-looks` edge)
- Selfie moderation + `selfiePath` fix through `virtual-tryon`
- Hostile audit mock tier: **38/38 PASS**

See `docs/VIRTUAL-WEAR-LOVABLE-UI.md` for full assessment.

## Quick start (local QA)

```bash
unzip -o ~/Downloads/MyYangaX.zip -d MyYangaX
cd MyYangaX
npm install
cp .env.example .env   # edit VITE_* vars
npm run dev
```

**Without cloud Supabase:**

```bash
npm run supabase-tester:start
npm run dev:tester
```

## Deploy to AWS Amplify

1. **Environment** — Copy `.env.example` → `.env`. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `PUBLIC_APP_URL` (Amplify domain).
2. **Build** — `npm run build` (output: `dist/`).
3. **Amplify settings** — Build command: `npm run build`; output directory: `dist`; add all `VITE_*` vars at build time.
4. **SPA routing** — Redirect `/*` → `/index.html` (200).
5. **Supabase edge** — `supabase link`, `npm run sb:deploy`, `supabase db push`.
6. **Secrets** — Set edge secrets per `docs/AWS_SECRETS_RUNBOOK.md` (Replicate, Gemini, WhatsApp, payments).
7. **Smoke test** — `npm run audit:hostile:mock-only` locally; `npm run audit:hostile:live` against deployed URL.

Full restage steps: `docs/AWS_RESTAGE.md`.

## Pre-ship audit

```bash
node scripts/hostile-audit.mjs --mock-only --skip-install --force-mock
```

Expected: **VERDICT: PASS** (Tier 1 + Tier 2).

## Key files in this zip

| File | Purpose |
|------|---------|
| `.env.example` | Required env vars |
| `docs/VIRTUAL-WEAR-LOVABLE-UI.md` | Lovable UI integration + scale notes |
| `docs/AWS_RESTAGE.md` | AWS/Amplify restage runbook |
| `docs/HOSTILE_AUDIT_REPORT.md` | Latest audit output |
| `docs/VERSION.md` | Release changelog |

## Tester account (QA)

| Email | Password | Role |
|-------|----------|------|
| `tester@myyanga.test` | `Test2026!` | Admin (tester) |

Create in Supabase Auth for cloud Tier 3 audits.
