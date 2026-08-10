# AWS Restage Runbook — MyYanga v5

Handoff package: `~/Downloads/MyYangaX.zip`

## Prerequisites

- Node.js 20+ (tested on 24.x)
- AWS Amplify app (or S3 + CloudFront) for static hosting
- Supabase cloud project **or** local Supabase Tester for QA

## 1. Unpack and install

```bash
cd ~/Downloads
unzip -o MyYangaX.zip -d MyYangaX
cd MyYangaX
npm install
```

## 2. Environment (production deploy)

Create `.env` from `.env.example` and set:

| Secret | Where |
|--------|-------|
| `VITE_SUPABASE_URL` | Supabase → Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API |
| `PUBLIC_APP_URL` | Amplify domain (e.g. `https://app.myyanga.com`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase (server/edge only — **never** in client bundle) |

Edge function secrets (Supabase dashboard → Edge Functions → Secrets):

- `REPLICATE_API_TOKEN` — virtual try-on (recommended)
- `GOOGLE_API_KEY` — virtual try-on fallback
- `WHATSAPP_CLOUD_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` — WhatsApp auth
- Payment keys per `docs/AWS_SECRETS_RUNBOOK.md`

## 3. Local QA without cloud Supabase

```bash
npm run supabase-tester:start    # :54322
npm run dev:tester               # Vite + .env.supabase-tester
USE_SUPABASE_TESTER=1 npm run audit:hostile
```

Expected: **VERDICT: PASS** (Tier 1–3).

## 4. Build for Amplify

```bash
npm run build
```

Amplify build settings:

- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Environment variables:** all `VITE_*` vars at build time

SPA redirects: ensure `/* → /index.html` (200) for client routing.

## 5. Deploy edge functions

```bash
supabase link --project-ref YOUR_REF
npm run sb:deploy
supabase db push   # migrations 001–011 + seed
```

Seed production data:

```bash
# After migrations, run 006_seed_production.sql via SQL editor or:
psql $DATABASE_URL -f supabase/migrations/006_seed_production.sql
```

## 6. Post-deploy smoke

```bash
LIVE_SITE_URL=https://your-amplify-url.amplifyapp.com \
VITE_SUPABASE_URL=... \
VITE_SUPABASE_ANON_KEY=... \
npm run audit:hostile:live
```

## 7. Rollback

- Amplify: redeploy previous build from console
- Supabase: point `VITE_SUPABASE_URL` to previous project or restore DB snapshot
- Edge functions: `supabase functions deploy <name> --version previous` from CLI history

## 8. Support docs in zip

- `docs/SUPABASE_TESTER.md` — local mock Supabase
- `docs/SUPABASE_TESTER-QA-REPORT.md` — QA findings
- `docs/HOSTILE_AUDIT_SPEC.md` — audit tiers
- `docs/AWS_SECRETS_RUNBOOK.md` — secret matrix
- `DEPLOYMENT_RUNBOOK.md` — full deploy steps

## Tester accounts

| Email | Password | Role |
|-------|----------|------|
| `tester@myyanga.test` | `Test2026!` | Admin (tester) |
| `oadeagbo@gmail.com` | (Google OAuth) | Founding owner |

Create `tester@myyanga.test` in Supabase Auth for cloud Tier 3 audits.
