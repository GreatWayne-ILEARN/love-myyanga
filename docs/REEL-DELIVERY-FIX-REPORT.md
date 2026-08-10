# Reel Delivery Fix Report

**Date:** 28 July 2026  
**Project:** MyYanga v4 (`/Users/olufemiadeagbo/Downloads/myyanga-v4`)

## Verdict

**Was it fixed before this session?** No.

Reel delivery was partially implemented in a prior session (client `reelEngine.js`, `send-reel` edge function, Reels UI, Settings schedule UI) but **never wired end-to-end**. Recent work (virtual wear, Supabase Tester, hostile audit) did not address reels.

**Root cause (why reels were not delivered):**

1. **No scheduler / cron** — Members save a reel schedule in Settings (`reelStore` localStorage only). Nothing in the app or on the server ever read that schedule and called `sendReelNow()`. Saving the schedule only showed a toast.
2. **In-app delivery could be skipped** — `dispatchReel` only wrote to the inbox when `channels.inapp !== false`. If a member turned off in-app and relied on email without `RESEND_API_KEY`, delivery reported **"none"**.
3. **Empty catalogue edge case** — If no garments matched assembly, reels could have zero panes (felt like "nothing delivered").
4. **Email path incomplete** — Client did not pass `reelUrl` to `send-reel` for email, so links were generic.
5. **Supabase Tester stub** — `send-reel` returned `{ ok: true, queued: true }` without validating channel contract (masked integration gaps).
6. **No DB-backed schedule worker** — `profiles.notification_list` / `notification_data` exist in schema but reel schedule was never synced; no server cron could run scheduled delivery for closed tabs.

Email without `RESEND_API_KEY` still soft-fails (501) by design; **in-app inbox is the can't-fail backstop**.

## What was fixed

| Area | Change |
|------|--------|
| `src/lib/reelScheduler.js` | **New** — `isScheduleDue`, `runScheduledReelDelivery`, `deliverWelcomeReelIfNeeded`, `startReelScheduler` (60s tick while app open) |
| `src/lib/reelEngine.js` | Always deliver in-app; fallback editorial pane if catalogue empty; pass `reelUrl` on email |
| `src/lib/reelStore.js` | `lastScheduledDelivery`, `welcomeDelivered` fields |
| `src/myyanga-app.jsx` | `startReelScheduler()` on mount |
| `src/pages/SettingsPage.jsx` | Welcome reel on first schedule save when inbox empty |
| `src/pages/ReelsPage.jsx` | Clearer success toast (pane count + channels) |
| `supabase-tester/functions.mjs` | Full `send-reel` mock (logs outbound, returns provider id) |
| `scripts/hostile-audit.mjs` | Mock: in-app delivery + scheduler due-check; Live: send-reel 401 + email dispatch |
| `scripts/test-supabase-tester.mjs` | send-reel QA case |
| `scripts/test-reel-delivery.mjs` | **New** standalone smoke test |
| `package.json` | `npm run test:reel-delivery` |

## How delivery works now

```
Settings save schedule → welcome reel if inbox empty
App mount → startReelScheduler (every 60s)
  → isScheduleDue(prefs) → sendReelNow()
    → assembleReel (garments + brand slots + fallback pane)
    → dispatchReel
      → in-app inbox (ALWAYS)
      → email / push / WhatsApp (if enabled)
Production email → edge send-reel → Resend (needs RESEND_API_KEY)
```

## Testing

```bash
# Standalone reel smoke (in-app + scheduler + send-reel via tester)
npm run test:reel-delivery

# Full tester QA (includes send-reel)
npm run test:supabase-tester

# Hostile audit mock tier (reel in-app path)
npm run audit:hostile:mock-only

# Tier 3 against Supabase Tester
USE_SUPABASE_TESTER=1 npm run audit:hostile
```

## Production secrets (email channel)

| Variable | Required for email | If missing |
|----------|-------------------|------------|
| `RESEND_API_KEY` | Yes | 501 soft-fail; in-app still works |
| `REEL_EMAIL_FROM` | Optional | Default `MyYanga <reels@myyanga.com>` |
| `WHATSAPP_CLOUD_TOKEN` | WhatsApp Cloud only | Queue + `wa.me` deep link |

## Remaining limitations (honest)

- **Scheduled delivery requires the app to be open** (or a future server cron reading synced prefs). Closing the tab stops the client scheduler.
- **Server-side cron** not implemented — would need edge worker + `profiles.notification_list` or `reel_prefs` jsonb sync.
- **Web push** server fan-out still needs VAPID + web-push library on edge.

## Files touched

- `/Users/olufemiadeagbo/Downloads/myyanga-v4/src/lib/reelScheduler.js` (new)
- `/Users/olufemiadeagbo/Downloads/myyanga-v4/src/lib/reelEngine.js`
- `/Users/olufemiadeagbo/Downloads/myyanga-v4/src/lib/reelStore.js`
- `/Users/olufemiadeagbo/Downloads/myyanga-v4/src/myyanga-app.jsx`
- `/Users/olufemiadeagbo/Downloads/myyanga-v4/src/pages/SettingsPage.jsx`
- `/Users/olufemiadeagbo/Downloads/myyanga-v4/src/pages/ReelsPage.jsx`
- `/Users/olufemiadeagbo/Downloads/myyanga-v4/supabase-tester/functions.mjs`
- `/Users/olufemiadeagbo/Downloads/myyanga-v4/scripts/hostile-audit.mjs`
- `/Users/olufemiadeagbo/Downloads/myyanga-v4/scripts/test-supabase-tester.mjs`
- `/Users/olufemiadeagbo/Downloads/myyanga-v4/scripts/test-reel-delivery.mjs` (new)
- `/Users/olufemiadeagbo/Downloads/myyanga-v4/package.json`
