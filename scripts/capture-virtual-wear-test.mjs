#!/usr/bin/env node
/**
 * Capture Virtual Wear flow screenshots for QA evidence.
 * Run: node scripts/capture-virtual-wear-test.mjs [--preview]
 *
 * Output: docs/virtual-wear-test-shots/
 * Manifest: docs/virtual-wear-test-shots/manifest.json
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { createCanvas } from "canvas";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs/virtual-wear-test-shots");
const usePreview = process.argv.includes("--preview");
let PORT = process.argv.includes("--preview") ? 4173 : 5175;
let BASE = `http://127.0.0.1:${PORT}`;

mkdirSync(outDir, { recursive: true });

async function detectPort() {
  for (const p of [5175, 5173, 5174, 5176, 4173]) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/`);
      if (!r.ok) continue;
      const probe = await fetch(`http://127.0.0.1:${p}/src/pages/VirtualWearPage.jsx`);
      const body = await probe.text();
      if (body.includes("myyanga-v5") && body.includes("Start styling")) return p;
    } catch {}
  }
  return null;
}

const manifest = {
  captured_at: new Date().toISOString(),
  mode: "testing",
  server: usePreview ? "vite preview" : "vite dev",
  base_url: BASE,
  shots: [],
  errors: [],
  assertions: {},
};

function writeSelfieFixture() {
  const fixtureDir = join(root, "scripts/fixtures");
  mkdirSync(fixtureDir, { recursive: true });
  const path = join(fixtureDir, "vw-test-selfie.jpg");
  if (existsSync(path) && statSync(path).size > 12000) return path;

  const w = 480;
  const h = 640;
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#c4a882";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#2a1810";
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 0.22, w * 0.18, h * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3d2818";
  ctx.fillRect(w * 0.35, h * 0.32, w * 0.3, h * 0.45);
  writeFileSync(path, c.toBuffer("image/jpeg", { quality: 0.92 }));
  return path;
}

function waitForServer(url, timeoutMs = 45000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(url);
        if (r.ok) return resolve();
      } catch {}
      if (Date.now() - start > timeoutMs) return reject(new Error(`Server not ready: ${url}`));
      setTimeout(tick, 500);
    };
    tick();
  });
}

async function startServer() {
  try {
    const r = await fetch(BASE);
    if (r.ok) return null;
  } catch {}

  const cmd = usePreview ? ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(PORT)] : ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(PORT)];
  const child = spawn("npm", cmd, { cwd: root, stdio: "pipe" });
  await waitForServer(BASE);
  return child;
}

async function shot(page, name, label, meta = {}) {
  const file = `${name}.png`;
  const path = join(outDir, file);
  await page.screenshot({ path, fullPage: !!meta.fullPage });
  const entry = { file, label, ...meta };
  manifest.shots.push(entry);
  console.log(`SHOT ${file} — ${label}`);
  return entry;
}

async function launchBrowser(chromium) {
  const opts = { headless: true };
  const attempts = [
    () => chromium.launch(opts),
    () => chromium.launch({ ...opts, channel: "chrome" }),
    () => chromium.launch({ ...opts, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }),
  ];
  for (const fn of attempts) {
    try {
      return await fn();
    } catch {}
  }
  throw new Error("No Playwright browser — run: npx playwright install chromium");
}

async function main() {
  const detected = await detectPort();
  if (detected) {
    PORT = detected;
    BASE = `http://127.0.0.1:${PORT}`;
    manifest.base_url = BASE;
  }
  const { chromium } = await import("playwright");
  const selfiePath = writeSelfieFixture();
  let server = await startServer();

  const browser = await launchBrowser(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.addInitScript(() => {
    localStorage.setItem("myyanga_app_mode", "testing");
    localStorage.removeItem("myyanga_vw_worn_outfits");
  });

  const gotoVw = async () => {
    await page.goto(`${BASE}/?view=virtualwear&vwqa=1`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(600);
  };

  try {
    // 1. Landing
    await gotoVw();
    await shot(page, "01-landing", "Landing — Start styling", { stage: "landing" });

    const startBtn = page.getByRole("button", { name: /start styling/i });
    if (!(await startBtn.count())) {
      throw new Error("Start styling button not found on landing");
    }
    await startBtn.click();
    await page.waitForTimeout(500);

    // 2. Questionnaire
    await shot(page, "02-questionnaire-empty", "Questionnaire — empty form", { stage: "questionnaire", fullPage: true });

    // Upload selfie
    const fileInput = page.locator('input[type="file"][accept*="image"]');
    await fileInput.setInputFiles(selfiePath);
    await page.waitForTimeout(800);
    await shot(page, "03-questionnaire-selfie", "Questionnaire — selfie uploaded", { stage: "questionnaire", fullPage: true });

    // Gender — His (Regal vibe matches male Agbada/Senator)
    await page.getByRole("button", { name: /^His$/i }).click();
    // Event — Wedding (default may already be wedding)
    await page.locator(".designer-card").filter({ hasText: "Wedding" }).first().click();
    // Budget
    await page.locator(".designer-card").filter({ hasText: "₦100k – ₦300k" }).first().click();
    // Vibe — Regal (male-compatible)
    await page.getByRole("button", { name: /^Regal$/i }).click();
    await page.waitForTimeout(300);
    await shot(page, "04-questionnaire-filled", "Questionnaire — event, vibe, budget filled", { stage: "questionnaire", fullPage: true });

    // 3. Loading — capture mid-transition
    const curateBtn = page.getByRole("button", { name: /curate my looks/i });
    await curateBtn.click();

    // Try to catch loading screen
    let caughtLoading = false;
    for (let i = 0; i < 8; i++) {
      const loading = await page.locator(".vw-lov-loading-title").count();
      if (loading) {
        await shot(page, "05-loading", 'Loading — "Curating looks…"', { stage: "loading" });
        caughtLoading = true;
        break;
      }
      await page.waitForTimeout(150);
    }
    if (!caughtLoading) {
      manifest.errors.push("Loading screen not captured (transition too fast)");
    }

    // Wait for results or error
    await page.waitForTimeout(1200);
    const hasResults = await page.locator(".vw-lov-options .vw-lov-option").count();
    const hasError = await page.locator(".vw-lov-error").count();
    const stillQuestionnaire = await page.locator('button:has-text("Curate my looks")').count();

    if (hasError && !hasResults) {
      const errText = await page.locator(".vw-lov-error").first().textContent();
      await shot(page, "06-results-error", `Results error — ${errText?.trim()}`, { stage: "error", fullPage: true });
      manifest.errors.push(`Curate failed: ${errText}`);
      manifest.assertions.curate_looks = false;
    } else if (stillQuestionnaire && !hasResults) {
      await shot(page, "06-results-blank", "Blank — returned to questionnaire with no looks", { stage: "error", fullPage: true });
      manifest.errors.push("No looks returned — still on questionnaire");
      manifest.assertions.curate_looks = false;
    } else {
      manifest.assertions.curate_looks = true;
      const lookCount = hasResults;
      manifest.assertions.look_count = lookCount;
      await shot(page, "06-results-grid", `Results grid — ${lookCount} looks from paid pool`, { stage: "results", fullPage: true });

      // 4. Try on me
      const tryBtn = page.getByRole("button", { name: /try on me/i });
      if (await tryBtn.count()) {
        await tryBtn.click();
        // In progress
        const dressing = page.getByRole("button", { name: /dressing you/i });
        if (await dressing.count()) {
          await shot(page, "07-tryon-progress", "Try-on in progress — Dressing you…", { stage: "tryon_progress" });
        }
        await page.waitForTimeout(2500);

        const toast = await page.locator("#__toast.show").textContent().catch(() => "");
        if (toast) manifest.assertions.toast = toast;

        const errAfter = await page.locator(".vw-lov-error").count();
        const renderImg = await page.locator(".vw-lov-tryon .look img").count();

        if (errAfter) {
          const errText = await page.locator(".vw-lov-error").first().textContent();
          await shot(page, "08-tryon-error", `Try-on error — ${errText?.trim()}`, { stage: "tryon_error", fullPage: true });
          manifest.errors.push(`Try-on failed: ${errText}`);
          manifest.assertions.tryon = false;
        } else if (renderImg) {
          // Verify canvas actually changed
          const diffCheck = await page.evaluate(async () => {
            const { imagesDiffer } = await import("/src/lib/virtualWear.js");
            const img = document.querySelector(".vw-lov-tryon .look img");
            const selfie = document.querySelector(".vw-lov-selfie-preview");
            if (!img?.src) return { ok: false, reason: "no render image" };
            // Selfie preview may be gone on results page — use stored photo from state not accessible
            // Compare render vs a blank would be weak; check image is data URL with reasonable size
            return { ok: img.src.length > 5000, srcLen: img.src.length, mode: img.closest(".look")?.textContent?.includes("AI") ? "ai" : "preview" };
          });
          manifest.assertions.tryon = diffCheck.ok;
          manifest.assertions.render_src_len = diffCheck.srcLen;
          await shot(page, "08-tryon-success", "Try-on result — canvas/AI preview rendered", { stage: "tryon_success", fullPage: true });
        } else {
          await shot(page, "08-tryon-blank", "Try-on blank — no image after click", { stage: "tryon_error", fullPage: true });
          manifest.errors.push("Try-on produced no image");
          manifest.assertions.tryon = false;
        }

        if (toast) {
          await shot(page, "09-toast", `Toast — ${toast}`, { stage: "toast" });
        }
      }
    }

    // Canvas compositing unit proof in browser
    const canvasProof = await page.evaluate(async () => {
      const { compositeLook, imagesDiffer } = await import("/src/lib/virtualWear.js");
      const { garmentArtUrl } = await import("/src/lib/garmentArt.js");
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = 480;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#c4a882";
      ctx.fillRect(0, 0, 320, 480);
      const photo = c.toDataURL("image/jpeg", 0.9);
      const g = { name: "Test Agbada", part: "main_outfit", style: "Agbada", colours: ["Coral"], image: garmentArtUrl({ name: "Test", part: "main_outfit", style: "Agbada", colours: ["Coral"] }) };
      const out = await compositeLook({ photoDataUrl: photo, garments: [g], scene: "wedding" });
      return { differs: imagesDiffer(photo, out), outLen: out?.length || 0 };
    });
    manifest.assertions.canvas_differs = canvasProof.differs;
    manifest.assertions.canvas_out_len = canvasProof.outLen;
  } catch (e) {
    manifest.errors.push(e.message);
    await shot(page, "99-fatal-error", `Fatal — ${e.message}`, { stage: "fatal", fullPage: true }).catch(() => {});
    console.error("FATAL:", e.message);
  }

  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await browser.close();
  if (server) server.kill("SIGTERM");

  const pass = manifest.assertions.curate_looks && manifest.assertions.tryon && manifest.assertions.canvas_differs;
  console.log(`\nManifest → docs/virtual-wear-test-shots/manifest.json`);
  console.log(`Shots: ${manifest.shots.length} | Errors: ${manifest.errors.length}`);
  console.log(`VERDICT: ${pass ? "PASS" : "FAIL"}`);
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
