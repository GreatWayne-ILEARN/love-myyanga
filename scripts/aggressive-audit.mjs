#!/usr/bin/env node
/**
 * @deprecated Use `npm run audit:hostile` instead.
 *
 * aggressive-audit.mjs was a static string-check ship gate. It did not test
 * runtime behaviour, browser paths, canvas compositing, or live edge functions.
 *
 * Canonical audit: scripts/hostile-audit.mjs (three tiers: BUILD / MOCK / LIVE)
 * Spec: docs/HOSTILE_AUDIT_SPEC.md
 */
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

console.warn("\n⚠️  DEPRECATED: aggressive-audit.mjs → use `npm run audit:hostile`\n");
console.warn("   See docs/HOSTILE_AUDIT_SPEC.md for tier coverage.\n");

const r = spawnSync("node", ["scripts/hostile-audit.mjs", "--tier1-only"], {
  cwd: root,
  stdio: "inherit",
});

process.exit(r.status ?? 1);
