# Supabase Tester

Local mock of Supabase for MyYanga v5 — enables **Production mode** without cloud Supabase.

## Quick start

```bash
# Terminal 1 — mock Supabase (default port 54322)
npm run supabase-tester:start

# Terminal 2 — Vite wired to tester
npm run dev:tester
```

In the app: **Settings → Production**. Sign in with `tester@myyanga.test` / `Test2026!`.

## Environment

Copy or symlink `.env.supabase-tester`:

| Variable | Value |
|----------|-------|
| `VITE_SUPABASE_URL` | `http://127.0.0.1:54322` |
| `VITE_SUPABASE_ANON_KEY` | Standard Supabase local anon JWT |
| `SUPABASE_SERVICE_ROLE_KEY` | Standard Supabase local service JWT |
| `WA_AUTH_EXPOSE_OTP` | `1` (staging OTP in API response) |

Hostile audit Tier 3 against tester:

```bash
USE_SUPABASE_TESTER=1 npm run audit:hostile
```

QA smoke:

```bash
npm run test:supabase-tester
```

## What is mimicked

| Surface | Coverage |
|---------|----------|
| **Auth** | Password sign-in, magic link verify, WhatsApp OTP (exposed code), mock Google OAuth redirect |
| **REST** | `garments`, `creators`, `profiles`, `looks`, `events`, `pyl_entries`, upsert/insert/select |
| **RPC** | `get_feature_gate` (access=true), `admin_analytics`, access-control RPCs (stub ok), `vote_pyl`, delete RPCs |
| **Storage** | `looks` bucket upload + signed URLs |
| **Edge functions** | `smart-search`, `virtual-tryon`, `auth-whatsapp`, `payments` (stub), `ai-chat`, `send-reel` (stub) |

Seeded from migration `006_seed_production.sql` (creators + garments, no image URLs — `garmentArt.js` fills at runtime).

## Honest gaps (not 100% Supabase)

- **Real Google OAuth** — tester redirects with a mock session; no Google consent screen
- **Real WhatsApp SMS** — OTP returned in JSON when `WA_AUTH_EXPOSE_OTP=1`; no Meta Cloud API
- **Real email inbox** — magic links work via `token_hash` verify; no SMTP delivery
- **PostgREST** — subset of filters (`eq`, `gte`, `lte`, `cs`); no RLS engine, no realtime channels
- **AI providers** — `virtual-tryon` returns a deterministic mock image (differs from input); no Replicate/Gemini calls
- **Payments** — `payments` edge returns 503 for paid checkout; entitlements unlocked via `get_feature_gate`
- **Multi-instance** — in-memory/SQLite-style JSON store; not suitable for load testing

Goal: **mirror what MyYanga actually calls** so production code paths run locally without errors.

## Architecture

```
supabase-tester/
  server.mjs      HTTP router (:54322)
  config.mjs      Keys, ports, feature flags
  db.mjs          JSON store + seed data
  jwt.mjs         HS256 tokens (GoTrue-compatible)
  handlers.mjs    /auth/v1, /rest/v1, /storage/v1
  functions.mjs   /functions/v1/*
  .data/          Persisted store (gitignored)
```

## Port note

Default port is **54322** (not 54321) to avoid conflicting with Supabase CLI local stack. Override with `SUPABASE_TESTER_PORT`.

## Strict feature gates

By default all gates return `access: true`. Set `SUPABASE_TESTER_STRICT_GATES=1` to enforce paid entitlements from `monetization_settings`.
