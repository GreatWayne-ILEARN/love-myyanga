#!/usr/bin/env node
/**
 * Reel delivery smoke test — assemble, dispatch in-app, scheduler logic, send-reel edge.
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.supabase-tester");

function loadEnv() {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  if (!import.meta.env) {
    Object.defineProperty(import.meta, "env", { value: {}, configurable: true });
  }
  for (const k of ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]) {
    if (process.env[k]) import.meta.env[k] = process.env[k];
  }
}

loadEnv();

if (typeof globalThis.localStorage === "undefined") {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
}

async function ensureTester() {
  const url = process.env.VITE_SUPABASE_URL || "http://127.0.0.1:54322";
  try {
    const r = await fetch(`${url}/health`);
    if (r.ok) return { child: null, url };
  } catch {}
  const child = spawn("node", ["supabase-tester/server.mjs"], { cwd: root, stdio: "pipe" });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const h = await fetch(`${url}/health`);
      if (h.ok) return { child, url };
    } catch {}
  }
  throw new Error("Supabase tester did not start");
}

async function main() {
  const { assembleReel, dispatchReel } = await import("../src/lib/reelEngine.js");
  const { isScheduleDue } = await import("../src/lib/reelScheduler.js");
  const { loadReelInbox, loadReelPrefs, saveReelPrefs } = await import("../src/lib/reelStore.js");

  const reel = await assembleReel({ title: "CLI test reel" });
  if (!reel.panes?.length) throw new Error("assembleReel returned zero panes");

  const before = loadReelInbox().length;
  const { results } = await dispatchReel(reel);
  const inapp = results.find((r) => r.channel === "inapp");
  if (!inapp?.ok) throw new Error("in-app delivery failed");
  const after = loadReelInbox();
  if (!after.some((r) => r.id === reel.id)) throw new Error("reel not in inbox");

  const now = new Date();
  const due = isScheduleDue(
    {
      schedule: {
        frequency: "weekly",
        days: [["sun", "mon", "tue", "wed", "thu", "fri", "sat"][now.getDay()]],
        time_local: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
        quiet_start: "22:00",
        quiet_end: "07:00",
      },
      lastScheduledDelivery: null,
    },
    now,
  );
  if (!due) throw new Error("isScheduleDue should be true for current slot");

  const { child, url } = await ensureTester();
  const anon = process.env.VITE_SUPABASE_ANON_KEY;
  const fnBase = url.replace(/\/$/, "") + "/functions/v1";

  const signIn = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon },
    body: JSON.stringify({ email: "tester@myyanga.test", password: "Test2026!" }),
  });
  const signBody = await signIn.json();
  const token = signBody.access_token;
  if (!token) throw new Error("tester sign-in failed");

  const edge = await fetch(`${fnBase}/send-reel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      apikey: anon,
    },
    body: JSON.stringify({
      channel: "email",
      to: "tester@myyanga.test",
      reel,
      reelUrl: `${url}/?view=reels&reel=${reel.id}`,
    }),
  });
  const edgeBody = await edge.json();
  if (!edge.ok || !edgeBody.ok) throw new Error(`send-reel failed: ${edgeBody.error || edge.status}`);

  saveReelPrefs({ lastScheduledDelivery: null });
  console.log("PASS reel delivery smoke — inapp, scheduler, send-reel edge");
  if (child) child.kill("SIGTERM");
}

main().catch((e) => {
  console.error("FAIL reel delivery smoke:", e.message);
  process.exit(1);
});
