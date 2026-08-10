# Smart Search Fix Report

**Project:** `/Users/olufemiadeagbo/Downloads/myyanga-v4`  
**Date:** 2026-07-28  
**Status:** Edge contract fixed in source; local static tests pass. **Live Supabase edge deploy not run in this session.**

---

## Root cause

### Client vs edge mismatch

`SmartSearchPage.jsx` sends **array** filters in production:

- `categories`, `countries`, `events`, `styles`, `colours`, `parts`

The edge function `supabase/functions/smart-search/index.ts` only read **singular** fields:

- `event`, `style`, `colour`

Those filters were ignored in production, so users saw unfiltered or empty results. Deck building also required **≥2 items per style**, so tight filters often produced **zero decks**.

### Audit script bug

`scripts/aggressive-audit.mjs` line 176 duplicated `const vwp` and line 177 referenced undefined `ss`, causing a runtime crash before smart-search checks could run.

---

## What we fixed

| File | Change |
|------|--------|
| `supabase/functions/smart-search/index.ts` | Accept singular + plural params via `asStringArray()`; DB filters (`in`, `overlaps`, `or` for gender/unisex); post-filter for categories/countries/promoted/query; single-item deck builder with accessory pairing; `enrichGarmentImages()` for imageless DB rows |
| `scripts/aggressive-audit.mjs` | Fixed duplicate `vwp` / undefined `ss`; added smart-search source checks + node test; header note that edge contract is source-verified |
| `scripts/test-smart-search.mjs` | **New** — node unit tests for `matchGarment` filter logic |
| `package.json` | Added `test:smart-search` script |

### Edge filter mapping

| Filter | DB query | Post-filter |
|--------|----------|-------------|
| `gender` | `or(gender.eq.*, unisex, null)` | — |
| `styles` | `eq` or `in` | redundant safety in `matchGarment` |
| `colours` | `overlaps(colours, …)` | — |
| `events` | `overlaps(event_tags, …)` | — |
| `parts` | `eq` or `in` | — |
| `categories` | — | style/part/categories array (DB seed has no `categories` column) |
| `countries` | — | garment or `creator.country` |
| `priceBands` | — | band overlap (client does not yet send `priceBands` in prod POST) |
| `budgetMin` / `budgetMax` | `gte` / `lte` | — |
| `promotedOnly` | `is_premium` pre-filter | also checks `creator.is_promoted` |
| `query` | — | name/style/creator/categories substring |

### Deck builder

Mirrors testing-mode behaviour in `SmartSearchPage.jsx`:

1. Group `main_outfit` rows by style (fallback: all rows).
2. Pair each group with accessories from the matched pool.
3. Build decks from one or more pieces (`buildDeckItems` pairs singles with accessories).
4. Fallback deck: "Matched pieces" when no style-grouped deck is possible.

---

## Verification evidence (local)

```
=== Smart Search Filter Tests ===
PASS all matchGarment filter cases
ALL PASS
```

```
npm run build
✓ built in ~700ms
```

```
node scripts/aggressive-audit.mjs
Aggressive audit: 96 pass, 0 fail — 100/100 — SHIP
```

New smart-search audit lines:

- `smart search edge: plural + singular filter params`
- `smart search client: sends array filters`
- `smart search edge: single-item deck builder`
- `smart search edge: garment image enrichment`
- `smart search: filter matching (node)`

---

## Not verified in this session

| Item | Why |
|------|-----|
| Live edge invoke against deployed Supabase | Requires auth, feature gate, and `npm run sb:deploy` |
| Production Smart Search UI click path | Audit is static source + build only |
| `priceBands` in production POST body | `SmartSearchPage` does not send `priceBands` to edge yet (testing mode uses `matchGarment` locally) |
| AI summary with `ANTHROPIC_API_KEY` | Optional; search works without it |

### Deploy edge function after merge

```bash
cd ~/Downloads/myyanga-v4
npm run sb:deploy   # includes smart-search
```

Then smoke-test in Production mode: His/Hers → tick events/styles/colours → Apply, confirm garments and decks populate.

---

## Honest score

| Area | Result |
|------|--------|
| Source contract (client ↔ edge arrays) | **Fixed** |
| Filter unit tests | **Pass** |
| Production build | **Pass** |
| Aggressive audit | **96/96 pass** |
| Live production edge | **Not tested here** |

**Overall:** Repo is consistent and shippable from a static/build perspective. Production Smart Search correctness after deploy should be confirmed with one manual search in Production mode.
