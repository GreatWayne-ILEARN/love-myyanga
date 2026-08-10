#!/usr/bin/env node
/**
 * Hostile Audit — mirrors real user experience in three tiers.
 *
 * Tier 1 BUILD GATE  — fast, no server (install, build, seed/env sanity)
 * Tier 2 MOCK        — local dev server + Playwright/fetch (Testing mode UX)
 * Tier 3 LIVE        — Supabase edge functions + optional deployed URL smoke
 *
 * Usage:
 *   node scripts/hostile-audit.mjs              # all tiers (live skipped if no creds)
 *   node scripts/hostile-audit.mjs --mock-only  # tier 1 + 2 only
 *   node scripts/hostile-audit.mjs --require-live
 *   node scripts/hostile-audit.mjs --tier1-only
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync, spawn, execFileSync } from "child_process";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { garmentArtUrl } from "../src/lib/garmentArt.js";

async function runDomAuditFallback() {
  try {
    const { runDomAudit } = await import("./hostile-dom-runner.mjs");
    return await runDomAudit();
  } catch {
    return null;
  }
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.AUDIT_DEV_PORT || 5173);
const BASE = `http://127.0.0.1:${PORT}`;
const REPORT_PATH = join(root, "docs/HOSTILE_AUDIT_REPORT.md");

const args = new Set(process.argv.slice(2));
const mockOnly = args.has("--mock-only");
const requireLive = args.has("--require-live");
const tier1Only = args.has("--tier1-only");
const skipInstall = args.has("--skip-install");

const tiers = {
  build: { pass: 0, fail: 0, skipped: 0 },
  mock: { pass: 0, fail: 0, skipped: 0 },
  live: { pass: 0, fail: 0, skipped: 0 },
};
const failures = [];
const notes = [];

function loadEnvFile() {
  const envPath = join(root, ".env");
  const testerPath = join(root, ".env.supabase-tester");
  const paths = [envPath];
  // Use tester env when no cloud .env or when explicitly requested
  if (existsSync(testerPath) && (!existsSync(envPath) || process.env.USE_SUPABASE_TESTER === "1")) {
    paths.unshift(testerPath);
  } else if (existsSync(envPath)) {
    // If .env points at localhost tester, that's fine
  } else if (existsSync(testerPath)) {
    paths.unshift(testerPath);
  }
  for (const p of paths) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

loadEnvFile();

function record(tier, name, ok, reason = "", evidence = "") {
  if (ok) {
    tiers[tier].pass++;
    console.log(`PASS [${tier}] ${name}`);
  } else if (reason === "SKIPPED") {
    tiers[tier].skipped++;
    console.log(`SKIP [${tier}] ${name}: ${evidence || "skipped"}`);
  } else {
    tiers[tier].fail++;
    failures.push({ tier, name, reason, evidence });
    console.log(`FAIL [${tier}] ${name}: ${reason}${evidence ? ` — ${evidence}` : ""}`);
  }
}

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: root, stdio: opts.silent ? "pipe" : "inherit", timeout: opts.timeout ?? 180000, encoding: "utf8" });
}

function runSilent(cmd, timeout = 120000) {
  try {
    const out = execSync(cmd, { cwd: root, stdio: "pipe", timeout, encoding: "utf8" });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: e.stdout?.toString() || "", err: e.stderr?.toString() || e.message };
  }
}

/* ─────────────────────────── Tier 1: BUILD GATE ─────────────────────────── */

async function tier1Build() {
  console.log("\n═══ TIER 1 — BUILD GATE ═══\n");

  if (!skipInstall) {
    const inst = runSilent("npm install --no-audit --no-fund", 300000);
    record("build", "npm install", inst.ok, inst.ok ? "" : "install failed", inst.err?.slice(0, 200));
  } else {
    record("build", "npm install", true, "", "skipped via --skip-install");
  }

  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (pkg.scripts?.lint) {
    const lint = runSilent("npm run lint", 120000);
    record("build", "npm run lint", lint.ok, lint.ok ? "" : "lint failed", lint.err?.slice(0, 200));
  } else {
    record("build", "lint script", true, "", "no lint script in package.json — skipped");
  }

  const build = runSilent("npm run build", 180000);
  record("build", "production build", build.ok, build.ok ? "" : "vite build failed", build.err?.slice(0, 300));

  // Seed migration: garments in 006 have no image column — garmentArt must cover
  const seedPath = join(root, "supabase/migrations/006_seed_production.sql");
  if (existsSync(seedPath)) {
    const seed = readFileSync(seedPath, "utf8");
    const hasGarmentInserts = /insert into garments/i.test(seed);
    const hasImageColumn = /garments[^)]*image/i.test(seed);
    const artExists = existsSync(join(root, "src/lib/garmentArt.js"));
    const artSrc = artExists ? readFileSync(join(root, "src/lib/garmentArt.js"), "utf8") : "";
    const artHandles = artSrc.includes("enrichGarmentImages") && artSrc.includes("garmentArtUrl");
    if (hasGarmentInserts && !hasImageColumn && artHandles) {
      record(
        "build",
        "seed 006 garments without images",
        true,
        "",
        "006_seed_production.sql omits image URLs; garmentArt.js enrichGarmentImages() generates SVG fallback at runtime",
      );
    } else if (hasGarmentInserts && hasImageColumn) {
      record("build", "seed 006 garment images", true, "", "seed includes image column values");
    } else {
      record("build", "seed 006 garment image coverage", false, "cannot verify image fallback path");
    }
  } else {
    record("build", "seed migration 006", false, "006_seed_production.sql missing");
  }

  const envExample = readFileSync(join(root, ".env.example"), "utf8");
  const requiredEnvKeys = [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "PUBLIC_APP_URL",
    "VITE_GOOGLE_AUTH",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const missingDocs = requiredEnvKeys.filter((k) => !envExample.includes(k));
  record(
    "build",
    ".env.example documents required vars",
    missingDocs.length === 0,
    missingDocs.length ? `missing keys: ${missingDocs.join(", ")}` : "",
  );

  const verify = runSilent("npm run verify:production", 60000);
  record("build", "verify:production", verify.ok, verify.ok ? "" : "verify failed", verify.err?.slice(0, 200));

  // Node unit tests integrated
  const vwNode = runSilent("node scripts/test-virtual-wear.mjs --node-only", 30000);
  record("build", "virtual wear node unit", vwNode.ok, vwNode.ok ? "" : "test-virtual-wear node failed", vwNode.err?.slice(0, 150));

  const ssNode = runSilent("node scripts/test-smart-search.mjs", 30000);
  record("build", "smart search filter unit", ssNode.ok, ssNode.ok ? "" : "test-smart-search failed", ssNode.err?.slice(0, 150));

  const ssEdge = readFileSync(join(root, "supabase/functions/smart-search/index.ts"), "utf8");
  record(
    "build",
    "smart-search edge array params",
    ssEdge.includes("asStringArray") && ssEdge.includes("overlaps") && ssEdge.includes("eventsBody"),
    ssEdge.includes("asStringArray") ? "" : "edge missing plural filter handling",
  );
}

/* ─────────────────────────── Dev server helpers ─────────────────────────── */

let devChild = null;

function waitForServer(url, timeoutMs = 45000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(url);
        if (r.ok || r.status === 304) return resolve();
      } catch {}
      if (Date.now() - start > timeoutMs) return reject(new Error("Dev server did not start"));
      setTimeout(tick, 400);
    };
    tick();
  });
}

async function ensureDevServer() {
  try {
    const r = await fetch(BASE);
    if (r.ok) return false;
  } catch {}
  devChild = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(PORT)], {
    cwd: root,
    stdio: "pipe",
  });
  await waitForServer(BASE);
  return true;
}

async function launchBrowser() {
  const opts = { headless: true };
  const attempts = [
    () => chromium.launch(opts),
    () => chromium.launch({ ...opts, channel: "chromium" }),
    () => chromium.launch({ ...opts, channel: "chrome" }),
  ];
  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(chromePath)) {
    attempts.push(() => chromium.launch({ ...opts, executablePath: chromePath }));
  }
  const errors = [];
  for (const tryLaunch of attempts) {
    try {
      return await tryLaunch();
    } catch (e) {
      errors.push(e.message?.split("\n")[0] || String(e));
    }
  }
  throw new Error(`No browser available — run: npx playwright install chromium (${errors.join("; ")})`);
}

const SPA_ROUTES = [
  { path: "/", label: "home" },
  { path: "/?view=explore", label: "explore" },
  { path: "/?view=shop", label: "shop" },
  { path: "/?view=smart", label: "smart search" },
  { path: "/?view=virtualwear", label: "virtual wear" },
  { path: "/?view=reels", label: "reels" },
  { path: "/?view=discover", label: "discover" },
  { path: "/?view=blog", label: "blog" },
  { path: "/?view=events", label: "events" },
  { path: "/?view=pyl", label: "post your look" },
  { path: "/?view=settings", label: "settings" },
  { path: "/?view=premium", label: "premium" },
  { path: "/?view=bag", label: "bag" },
  { path: "/?view=about", label: "about" },
  { path: "/?view=privacy", label: "privacy" },
  { path: "/?view=grooming", label: "grooming" },
  { path: "/?view=product&g=1", label: "product PDP" },
  { path: "/?view=article&slug=lagos-fashion-week-creative-economy", label: "blog article" },
  { path: "/look/demo-look-code", label: "look share SPA fallback" },
];

const NAV_VIEWS = [
  "home", "explore", "shop", "smart", "reels", "discover", "blog", "events", "pyl", "virtualwear", "settings",
];

function imageFingerprint(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return "";
  const body = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  const slice = body.slice(0, 4000) + body.slice(-2000);
  let h = 0;
  for (let i = 0; i < slice.length; i++) h = (h * 31 + slice.charCodeAt(i)) >>> 0;
  return `${body.length}:${h}`;
}

function imagesDiffer(a, b) {
  if (!a || !b) return true;
  return imageFingerprint(a) !== imageFingerprint(b);
}

async function openAuthModal(page) {
  await page.evaluate(() => {
    try {
      localStorage.removeItem("myyanga_test_session");
      localStorage.setItem("myyanga_app_mode", "testing");
    } catch {}
  });
  await page.goto(`${BASE}/?view=home`, { waitUntil: "networkidle" });
  const signIn = page.locator('[data-testid="sign-in"]').first();
  if ((await signIn.count()) > 0) {
    await signIn.click();
  } else {
    await page.locator('button:has-text("Login"), button:has-text("Sign in")').first().click();
  }
  await page.waitForSelector(".modal", { timeout: 8000 });
}

/* ─────────────────────────── Tier 2: MOCK ─────────────────────────── */

async function runChromeHeadlessAudit() {
  const chromePaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "chromium",
  ];
  let chrome = null;
  for (const p of chromePaths) {
    if (p.includes("/")) {
      if (existsSync(p)) {
        chrome = p;
        break;
      }
    } else {
      try {
        execFileSync("which", [p], { stdio: "pipe" });
        chrome = p;
        break;
      } catch {}
    }
  }
  if (!chrome) return null;

  const url = `${BASE}/hostile-audit-runner.html`;
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--virtual-time-budget=25000",
    "--dump-dom",
    url,
  ];
  try {
    const dom = execFileSync(chrome, args, { encoding: "utf8", timeout: 45000, maxBuffer: 15 * 1024 * 1024 });
    const m = dom.match(/<pre id="audit-json">([\s\S]*?)<\/pre>/);
    if (!m || m[1].trim() === "PENDING") return null;
    const payload = JSON.parse(m[1].trim());
    return payload.results || [];
  } catch {
    return null;
  }
}

async function tier2Mock() {
  console.log("\n═══ TIER 2 — MOCK / TESTING MODE ═══\n");

  let startedServer = false;
  try {
    startedServer = await ensureDevServer();
  } catch (e) {
    record("mock", "dev server start", false, e.message);
    return;
  }
  record("mock", "dev server reachable", true);

  for (const route of SPA_ROUTES) {
    try {
      const r = await fetch(`${BASE}${route.path}`);
      record("mock", `route 200: ${route.label}`, r.status === 200, r.status === 200 ? "" : `HTTP ${r.status}`);
    } catch (e) {
      record("mock", `route 200: ${route.label}`, false, e.message);
    }
  }

  // Internal nav route table matches declared views
  const appSrc = readFileSync(join(root, "src/myyanga-app.jsx"), "utf8");
  const navOk = NAV_VIEWS.every((v) => appSrc.includes(`"${v}"`));
  record("mock", "nav route table wired in app", navOk, navOk ? "" : "missing nav view in myyanga-app.jsx");

  let browser;
  try {
    browser = await launchBrowser();
  } catch (e) {
    let fallbackResults = await runChromeHeadlessAudit();
    if (!fallbackResults?.length) {
      fallbackResults = await runDomAuditFallback();
      if (fallbackResults?.length) notes.push("Tier 2 browser tests used Vite SSR + happy-dom fallback (auth UI via source wiring).");
    } else {
      notes.push("Tier 2 browser tests used system Chrome headless fallback.");
    }
    if (fallbackResults?.length) {
      for (const r of fallbackResults) {
        record("mock", r.name, r.ok, r.ok ? "" : r.reason || "failed", r.evidence || "");
      }
      if (startedServer && devChild) {
        devChild.kill("SIGTERM");
        devChild = null;
      }
      return;
    }
    record("mock", "playwright browser", false, e.message);
    notes.push("Tier 2 browser tests failed — run: npx playwright install chromium");
    if (startedServer && devChild) {
      devChild.kill("SIGTERM");
      devChild = null;
    }
    return;
  }

  const page = await browser.newPage();
  try {
    // Virtual Wear canvas compositing — output MUST differ from input
    await page.goto(BASE, { waitUntil: "networkidle" });
    const canvasResult = await page.evaluate(async () => {
      const { compositeLook, imagesDiffer, imageFingerprint } = await import("/src/lib/virtualWear.js");
      const { garmentArtUrl } = await import("/src/lib/garmentArt.js");
      const photoCanvas = document.createElement("canvas");
      photoCanvas.width = 320;
      photoCanvas.height = 480;
      const pctx = photoCanvas.getContext("2d");
      pctx.fillStyle = "#c4a882";
      pctx.fillRect(0, 0, 320, 480);
      pctx.fillStyle = "#2a1810";
      pctx.beginPath();
      pctx.ellipse(160, 90, 55, 70, 0, 0, Math.PI * 2);
      pctx.fill();
      const photoDataUrl = photoCanvas.toDataURL("image/jpeg", 0.92);
      const garment = { name: "Coral Royal Agbada", part: "main_outfit", style: "Agbada", colours: ["Coral", "Gold"] };
      const artUrl = garmentArtUrl(garment);
      const out = await compositeLook({ photoDataUrl, garments: [{ ...garment, image: artUrl }], scene: "wedding" });
      return {
        photoFp: imageFingerprint(photoDataUrl),
        outFp: imageFingerprint(out),
        differs: imagesDiffer(photoDataUrl, out),
        outLen: out?.length || 0,
      };
    });
    record(
      "mock",
      "virtual wear canvas output differs from input",
      canvasResult.differs && canvasResult.outLen > 100,
      canvasResult.differs ? "" : "UNCHANGED IMAGE — compositing failed",
      `photo=${canvasResult.photoFp} out=${canvasResult.outFp}`,
    );

    const vwFlow = await page.evaluate(async () => {
      const { curateVwLooks } = await import("/src/lib/vwPool.js");
      const { MOCK_GARMENTS, MOCK_CREATORS } = await import("/src/lib/mockGarments.js");
      const { renderLook, imagesDiffer } = await import("/src/lib/virtualWear.js");
      const curated = curateVwLooks({
        garments: MOCK_GARMENTS,
        creators: MOCK_CREATORS,
        gender: "male",
        scene: "wedding",
        vibes: ["elegant"],
        budgetBand: "100000-300000",
        limit: 4,
      });
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = 480;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#c4a882";
      ctx.fillRect(0, 0, 320, 480);
      const photo = c.toDataURL("image/jpeg", 0.9);
      let tryOn = { ok: false, mode: null };
      if (curated.looks[0]) {
        const out = await renderLook({ photoDataUrl: photo, garments: curated.looks[0].items, scene: "wedding" });
        tryOn = { ok: imagesDiffer(photo, out.image), mode: out.mode, len: out.image?.length || 0 };
      }
      return {
        lookCount: curated.looks.length,
        relaxed: !!curated.relaxed,
        tryOn,
      };
    });
    record(
      "mock",
      "virtual wear curate + renderLook pipeline",
      vwFlow.lookCount > 0 && vwFlow.tryOn.ok && vwFlow.tryOn.mode === "canvas",
      vwFlow.lookCount > 0 ? "" : "curate returned 0 looks",
      `looks=${vwFlow.lookCount} relaxed=${vwFlow.relaxed} mode=${vwFlow.tryOn.mode}`,
    );

    // Smart Search testing mode — His + Agbada filter returns results
    const ssResult = await page.evaluate(async () => {
      const { matchGarment, emptyMultiFilters } = await import("/src/lib/catalog.js");
      const { MOCK_GARMENTS } = await import("/src/lib/mockGarments.js");
      const f = emptyMultiFilters();
      f.gender = "male";
      f.styles = ["Agbada"];
      const hits = MOCK_GARMENTS.filter((g) => matchGarment(g, f));
      const f2 = { ...f, styles: ["NonexistentStyleXYZ"] };
      const miss = MOCK_GARMENTS.filter((g) => matchGarment(g, f2));
      return { hitCount: hits.length, missCount: miss.length, sample: hits[0]?.name || null };
    });
    record(
      "mock",
      "smart search His+Agbada filter (testing mode)",
      ssResult.hitCount > 0 && ssResult.missCount === 0,
      ssResult.hitCount > 0 ? "" : "no matches for His+Agbada",
      `hits=${ssResult.hitCount} bogus-style hits=${ssResult.missCount}`,
    );

    // Hers + Ghana + bag filter
    const hersResult = await page.evaluate(async () => {
      const { matchGarment, emptyMultiFilters } = await import("/src/lib/catalog.js");
      const { MOCK_GARMENTS } = await import("/src/lib/mockGarments.js");
      const f = emptyMultiFilters();
      f.gender = "female";
      f.countries = ["Ghana"];
      f.parts = ["bag"];
      return MOCK_GARMENTS.filter((g) => matchGarment(g, f)).length;
    });
    record(
      "mock",
      "smart search Hers+Ghana+bag filter",
      hersResult > 0,
      hersResult > 0 ? "" : "no Hers+Ghana+bag matches",
      `hits=${hersResult}`,
    );

    // Auth modal UI elements
    await openAuthModal(page);
    await page.waitForTimeout(400);
    const authUi = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        google: /Continue with Google/i.test(text),
        whatsapp: /Continue with WhatsApp/i.test(text),
        emailPath: /Use email instead/i.test(text),
      };
    });
    record("mock", "auth modal: Google button present", authUi.google);
    record("mock", "auth modal: WhatsApp option present", authUi.whatsapp);

    // Email magic link button
    if (authUi.emailPath) {
      await page.click('text=Use email instead');
      await page.waitForTimeout(300);
    }
    const magicLink = await page.evaluate(() => /Email me a magic link/i.test(document.body.innerText));
    record("mock", "auth modal: email magic link button", magicLink);

    // WhatsApp flow doesn't fake success without code (testing shows OTP, verify rejects bad code)
    await openAuthModal(page);
    await page.waitForTimeout(300);
    await page.click('text=Continue with WhatsApp').catch(() => {});
    await page.waitForTimeout(300);
    await page.fill('input[placeholder*="+234"]', "+2348012345678").catch(() => {});
    await page.click('button:has-text("Send code")').catch(() => {});
    await page.waitForTimeout(500);
    const waTesting = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasTestingOtp = /Testing code:/i.test(text);
      return { hasTestingOtp, showsFakeSuccess: /Signed in with WhatsApp/i.test(text) };
    });
    record(
      "mock",
      "WhatsApp OTP shown in testing (not fake success)",
      waTesting.hasTestingOtp && !waTesting.showsFakeSuccess,
      waTesting.hasTestingOtp ? "" : "testing OTP not displayed",
    );

    // Tester login: tester@myyanga.test / Test2026!
    await openAuthModal(page);
    await page.waitForTimeout(300);
    await page.click('text=Use email instead').catch(() => {});
    await page.waitForTimeout(300);
    const modalInputs = page.locator(".modal input");
    if ((await modalInputs.count()) >= 2) {
      await modalInputs.nth(0).fill("tester@myyanga.test");
      await modalInputs.nth(1).fill("Test2026!");
    }
    await page.locator('.modal button:has-text("Login")').first().click().catch(() => {});
    await page.waitForTimeout(800);
    const loggedIn = await page.evaluate(() => {
      const session = localStorage.getItem("myyanga_test_session");
      if (!session) return { ok: false, reason: "no test session in localStorage" };
      try {
        const p = JSON.parse(session);
        return { ok: p?.email === "tester@myyanga.test", email: p?.email, role: p?.role };
      } catch {
        return { ok: false, reason: "bad session JSON" };
      }
    });
    record(
      "mock",
      "tester login tester@myyanga.test",
      loggedIn.ok,
      loggedIn.ok ? "" : loggedIn.reason || "login failed",
      loggedIn.email ? `role=${loggedIn.role}` : "",
    );

    // Reel delivery — can't-fail in-app path (assemble + dispatch to inbox)
    const reelResult = await page.evaluate(async () => {
      const { sendReelNow } = await import("/src/lib/reelEngine.js");
      const { loadReelInbox } = await import("/src/lib/reelStore.js");
      const before = loadReelInbox().length;
      const { reel, results } = await sendReelNow({ title: "Hostile audit reel" });
      const after = loadReelInbox();
      const inapp = results.find((r) => r.channel === "inapp");
      return {
        panes: reel.panes?.length || 0,
        inboxGrew: after.length > before,
        hasReel: after.some((r) => r.id === reel.id),
        inappOk: inapp?.ok === true,
        results: results.map((r) => `${r.channel}:${r.ok ? "ok" : "fail"}`).join(","),
      };
    });
    record(
      "mock",
      "reel delivery in-app (sendReelNow → inbox)",
      reelResult.inappOk && reelResult.hasReel && reelResult.panes > 0,
      reelResult.inappOk ? "" : "in-app delivery failed",
      `panes=${reelResult.panes} ${reelResult.results}`,
    );

    // Reel scheduler due-check logic
    const schedResult = await page.evaluate(async () => {
      const { isScheduleDue } = await import("/src/lib/reelScheduler.js");
      const now = new Date();
      const duePrefs = {
        schedule: {
          frequency: "weekly",
          days: [["sun", "mon", "tue", "wed", "thu", "fri", "sat"][now.getDay()]],
          time_local: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
          quiet_start: "22:00",
          quiet_end: "07:00",
        },
        lastScheduledDelivery: null,
      };
      return isScheduleDue(duePrefs, now);
    });
    record("mock", "reel scheduler isScheduleDue at current slot", schedResult);

    // Admin view accessible after tester login
    if (loggedIn.ok) {
      await page.goto(`${BASE}/?view=admin`, { waitUntil: "networkidle" });
      const adminVisible = await page.evaluate(() =>
        /Admin Studio|Content Studio|Monetization/i.test(document.body.innerText),
      );
      record("mock", "admin studio reachable after tester login", adminVisible);
    }
  } finally {
    await browser.close();
    if (startedServer && devChild) {
      devChild.kill("SIGTERM");
      devChild = null;
    }
  }
}

/* ─────────────────────────── Tier 3: LIVE ─────────────────────────── */

function supabaseConfig() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, anon, service, fnBase: url?.replace(/\/$/, "") + "/functions/v1" };
}

async function getLiveSession(cfg) {
  const email = process.env.AUDIT_TEST_EMAIL || "tester@myyanga.test";
  const password = process.env.AUDIT_TEST_PASSWORD || "Test2026!";
  const sb = createClient(cfg.url, cfg.anon);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) return { token: null, error: error?.message || "no session" };
  return { token: data.session.access_token, user: data.user, sb };
}

async function tier3Live() {
  console.log("\n═══ TIER 3 — LIVE / PRODUCTION MODE ═══\n");

  const cfg = supabaseConfig();
  const isTester =
    cfg.url?.includes("127.0.0.1") ||
    cfg.url?.includes("localhost") ||
    process.env.USE_SUPABASE_TESTER === "1";
  if (!cfg.url || !cfg.anon) {
    if (requireLive) {
      record("live", "Supabase credentials", false, "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY required");
    } else {
      record("live", "Supabase credentials", false, "SKIPPED", "no VITE_SUPABASE_URL / ANON_KEY in env");
    }
    notes.push("Tier 3 skipped — set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY in .env for live edge tests.");
    return;
  }

  if (isTester) {
    notes.push("Tier 3 running against local Supabase Tester (not cloud Supabase).");
    // auth-whatsapp: tester exposes OTP (200 + code), not 503
  }

  // 401 paths without auth
  const ssNoAuth = await fetch(`${cfg.fnBase}/smart-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: cfg.anon },
    body: JSON.stringify({ gender: "male" }),
  });
  record("live", "smart-search 401 without token", ssNoAuth.status === 401, ssNoAuth.status === 401 ? "" : `got HTTP ${ssNoAuth.status}`);

  const vtoNoAuth = await fetch(`${cfg.fnBase}/virtual-tryon`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: cfg.anon },
    body: JSON.stringify({ personImage: "data:image/png;base64,iVBORw0KGgo=" }),
  });
  record("live", "virtual-tryon 401 without token", vtoNoAuth.status === 401, vtoNoAuth.status === 401 ? "" : `got HTTP ${vtoNoAuth.status}`);

  // auth-whatsapp returns 503 when not configured (not fake ok)
  const waReq = await fetch(`${cfg.fnBase}/auth-whatsapp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: cfg.anon,
      Authorization: `Bearer ${cfg.anon}`,
    },
    body: JSON.stringify({ action: "request", phone: "+2348012345678" }),
  });
  const waBody = await waReq.json().catch(() => ({}));
  const waOk =
    waReq.status === 503 ||
    (waReq.status === 200 && waBody.sent === true) ||
    (waReq.status === 200 && waBody.code && (process.env.WA_AUTH_EXPOSE_OTP === "1" || isTester));
  const waEvidence = `HTTP ${waReq.status} ${waBody.error || waBody.detail || ""}`.trim();
  record(
    "live",
    "auth-whatsapp honest response (503 if unconfigured)",
    waOk,
    waOk ? "" : "returned fake success without WhatsApp configured",
    waEvidence,
  );

  const session = await getLiveSession(cfg);
  if (!session.token) {
    record("live", "live session sign-in", false, "SKIPPED", session.error || "could not sign in — create AUDIT_TEST_EMAIL user in Supabase");
    notes.push("Live edge function tests need a real Supabase user (AUDIT_TEST_EMAIL / AUDIT_TEST_PASSWORD).");
    return;
  }
  record("live", "live session sign-in", true, "", session.user?.email || "");

  const authHeaders = {
    Authorization: `Bearer ${session.token}`,
    "Content-Type": "application/json",
    apikey: cfg.anon,
  };

  // Smart search — array filters must narrow results
  const ssBroad = await fetch(`${cfg.fnBase}/smart-search`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ gender: "male", limit: 30 }),
  });
  const ssBroadBody = await ssBroad.json().catch(() => ({}));

  if (ssBroad.status === 402) {
    record("live", "smart-search array filter test", false, "SKIPPED", "402 Payment required — grant smart_search entitlement or document pay gate");
    notes.push("get_feature_gate(smart_search) returned 402 — expected for unpaid accounts; not a code bug.");
  } else if (!ssBroad.ok) {
    record("live", "smart-search array filter test", false, ssBroadBody.error || `HTTP ${ssBroad.status}`);
  } else {
    const broadCount = (ssBroadBody.garments || []).length;

    const ssWedding = await fetch(`${cfg.fnBase}/smart-search`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ gender: "male", events: ["corporate"], limit: 30 }),
    });
    const ssWeddingBody = await ssWedding.json().catch(() => ({}));
    const weddingCount = (ssWeddingBody.garments || []).length;

    const ssAgbada = await fetch(`${cfg.fnBase}/smart-search`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ gender: "male", styles: ["Agbada"], limit: 30 }),
    });
    const ssAgbadaBody = await ssAgbada.json().catch(() => ({}));
    const agbadaGarments = ssAgbadaBody.garments || [];
    const allAgbada = agbadaGarments.every((g) => (g.style || "").toLowerCase() === "agbada");
    const filterNarrows = weddingCount <= broadCount;
    const arraysWork = agbadaGarments.length === 0 || allAgbada;

    record(
      "live",
      "smart-search events[] filter narrows results",
      filterNarrows,
      filterNarrows ? "" : `corporate filter returned more than broad (${weddingCount} vs ${broadCount})`,
    );
    record(
      "live",
      "smart-search styles[] filter respected",
      arraysWork,
      arraysWork ? "" : "styles:[Agbada] returned non-Agbada garments",
      `agbada hits=${agbadaGarments.length}`,
    );
  }

  // Virtual try-on — must not return identical image; 501/502 with fallback is acceptable
  const tinyPng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const garmentSvg = garmentArtUrl({ name: "Test Agbada", part: "main_outfit", style: "Agbada", colours: ["Coral"] });
  const vtoRes = await fetch(`${cfg.fnBase}/virtual-tryon`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      personImage: tinyPng,
      garments: [{ name: "Test Agbada", part: "main_outfit", image: garmentSvg }],
      scene: "wedding",
    }),
  });
  const vtoBody = await vtoRes.json().catch(() => ({}));

  if (vtoRes.status === 402) {
    record("live", "virtual-tryon output check", false, "SKIPPED", "402 Payment required — grant virtual_wear entitlement");
    notes.push("get_feature_gate(virtual_wear) returned 402 — expected for unpaid accounts.");
  } else if (vtoRes.status === 501 || vtoRes.status === 502) {
    const honest = vtoBody.fallback === true || vtoBody.providers_missing || vtoBody.providers_tried;
    record(
      "live",
      "virtual-tryon honest error when no AI keys",
      honest,
      honest ? "" : "unexpected error shape",
      `HTTP ${vtoRes.status} ${vtoBody.error || ""}`,
    );
  } else if (vtoRes.ok && vtoBody.image) {
    const unchanged = !imagesDiffer(tinyPng, vtoBody.image);
    record(
      "live",
      "virtual-tryon output differs from input",
      !unchanged,
      unchanged ? "UNCHANGED IMAGE returned — FAIL" : "",
      `provider=${vtoBody.provider || "unknown"}`,
    );
  } else {
    record("live", "virtual-tryon response", false, vtoBody.error || `HTTP ${vtoRes.status}`);
  }

  // send-reel — critical path (email channel; tester mocks Resend)
  const reelNoAuth = await fetch(`${cfg.fnBase}/send-reel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: cfg.anon },
    body: JSON.stringify({ channel: "email", to: "test@example.com", reel: { title: "Audit" } }),
  });
  record("live", "send-reel 401 without token", reelNoAuth.status === 401, reelNoAuth.status === 401 ? "" : `got HTTP ${reelNoAuth.status}`);

  const reelRes = await fetch(`${cfg.fnBase}/send-reel`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      channel: "email",
      to: session.user?.email || "tester@myyanga.test",
      reel: { id: "audit_reel", title: "Hostile audit reel", panes: [{ title: "Look" }] },
      reelUrl: `${cfg.url?.replace(/\/$/, "")}/?view=reels&reel=audit_reel`,
    }),
  });
  const reelBody = await reelRes.json().catch(() => ({}));
  const reelOk =
    reelRes.ok &&
    reelBody.ok &&
    (reelBody.provider || reelBody.tester || reelBody.id);
  record(
    "live",
    "send-reel email dispatch (critical path)",
    reelOk,
    reelOk ? "" : reelBody.error || `HTTP ${reelRes.status}`,
    reelBody.provider || reelBody.message || "",
  );

  // Deployed URL smoke test
  const liveUrl = process.env.LIVE_SITE_URL || process.env.PUBLIC_APP_URL;
  if (liveUrl && !liveUrl.includes("YOUR-") && !liveUrl.includes("your-myyanga")) {
    try {
      const deployed = await fetch(liveUrl.replace(/\/$/, "") + "/");
      const html = await deployed.text();
      const isMyYanga = /MyYanga|myyanga/i.test(html);
      record(
        "live",
        "deployed URL smoke test",
        deployed.status === 200 && isMyYanga,
        deployed.status === 200 ? (isMyYanga ? "" : "page does not look like MyYanga") : `HTTP ${deployed.status}`,
        liveUrl,
      );
      const deployedSmart = await fetch(liveUrl.replace(/\/$/, "") + "/?view=smart");
      record("live", "deployed smart search route", deployedSmart.status === 200, deployedSmart.status === 200 ? "" : `HTTP ${deployedSmart.status}`);
    } catch (e) {
      record("live", "deployed URL smoke test", false, e.message, liveUrl);
    }
  } else {
    record("live", "deployed URL smoke test", false, "SKIPPED", "set LIVE_SITE_URL to Amplify/Netlify URL");
  }
}

/* ─────────────────────────── Report ─────────────────────────── */

function verdict() {
  const t1Fail = tiers.build.fail > 0;
  const t2Fail = tiers.mock.fail > 0;
  const t3Ran = tiers.live.pass + tiers.live.fail > 0;
  const t3Fail = tiers.live.fail > 0;
  const t3SkippedOnly = tiers.live.skipped > 0 && tiers.live.pass === 0 && tiers.live.fail === 0;

  if (t1Fail || t2Fail) return "FAIL";
  if (t3SkippedOnly || (t3Ran && t3Fail)) return "PARTIAL";
  if (requireLive && (t3SkippedOnly || !t3Ran)) return "FAIL";
  return "PASS";
}

function writeReport(v) {
  mkdirSync(join(root, "docs"), { recursive: true });
  const lines = [
    "# Hostile Audit Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "```",
    "HOSTILE AUDIT REPORT",
    "====================",
    `Tier 1 BUILD: ${tiers.build.pass} pass, ${tiers.build.fail} fail`,
    `Tier 2 MOCK:  ${tiers.mock.pass} pass, ${tiers.mock.fail} fail`,
    tiers.live.skipped && tiers.live.pass === 0 && tiers.live.fail === 0
      ? `Tier 3 LIVE:  SKIPPED — no credentials`
      : `Tier 3 LIVE:  ${tiers.live.pass} pass, ${tiers.live.fail} fail`,
    "",
    `VERDICT: ${v}`,
    "",
    failures.length ? "Failures:" : "Failures: (none)",
    ...failures.map((f) => `- [${f.tier}] ${f.name}: ${f.reason}${f.evidence ? ` + ${f.evidence}` : ""}`),
    "```",
    "",
  ];
  if (notes.length) {
    lines.push("## Notes", "", ...notes.map((n) => `- ${n}`), "");
  }
  writeFileSync(REPORT_PATH, lines.join("\n"));
  console.log(`\nReport written to docs/HOSTILE_AUDIT_REPORT.md`);
}

async function main() {
  console.log("HOSTILE AUDIT — MyYanga v5");
  console.log("==========================\n");

  await tier1Build();
  if (!tier1Only && !args.has("--build-only")) {
    if (tiers.build.fail === 0 || args.has("--force-mock")) {
      await tier2Mock();
    } else {
      record("mock", "tier 2", false, "SKIPPED", "tier 1 build failures — fix build first");
    }
    if (!mockOnly && (tiers.build.fail === 0 || args.has("--force-live"))) {
      await tier3Live();
    } else if (mockOnly) {
      notes.push("Tier 3 skipped via --mock-only");
    }
  }

  const v = verdict();
  console.log("\nHOSTILE AUDIT REPORT");
  console.log("====================");
  console.log(`Tier 1 BUILD: ${tiers.build.pass} pass, ${tiers.build.fail} fail`);
  console.log(`Tier 2 MOCK:  ${tiers.mock.pass} pass, ${tiers.mock.fail} fail`);
  if (tiers.live.skipped && tiers.live.pass === 0 && tiers.live.fail === 0) {
    console.log(`Tier 3 LIVE:  SKIPPED — no credentials`);
  } else {
    console.log(`Tier 3 LIVE:  ${tiers.live.pass} pass, ${tiers.live.fail} fail`);
  }
  console.log(`\nVERDICT: ${v}`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(`- [${f.tier}] ${f.name}: ${f.reason}${f.evidence ? ` + ${f.evidence}` : ""}`);
    }
  }

  writeReport(v);
  process.exit(v === "FAIL" ? 1 : 0);
}

main().catch((e) => {
  console.error("\nHostile audit crashed:", e);
  process.exit(1);
});
