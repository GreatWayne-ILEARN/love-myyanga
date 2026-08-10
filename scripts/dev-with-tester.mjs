#!/usr/bin/env node
/**
 * Start Vite dev server wired to Supabase Tester (.env.supabase-tester).
 * Starts tester if not already running.
 */
import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TESTER_URL = "http://127.0.0.1:54322/health";
const envPath = join(root, ".env.supabase-tester");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadEnvFile(envPath);

async function testerUp() {
  try {
    const r = await fetch(TESTER_URL);
    return r.ok;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await testerUp())) {
    console.log("Starting Supabase Tester on :54322…");
    const tester = spawn("node", ["supabase-tester/server.mjs"], {
      cwd: root,
      stdio: "inherit",
      detached: true,
    });
    tester.unref();
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 300));
      if (await testerUp()) break;
    }
    if (!(await testerUp())) {
      console.error("Supabase Tester did not start — run: npm run supabase-tester:start");
      process.exit(1);
    }
  }

  console.log("Dev server → Supabase Tester (Production mode available)");
  const vite = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env },
  });
  vite.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
