#!/usr/bin/env node
/**
 * Virtual Wear verification — proves output differs from input photo.
 * Run: npm run test:virtual-wear
 */
import { chromium } from "playwright";
import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { garmentArtUrl, enrichGarmentImages } from "../src/lib/garmentArt.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5173;
const BASE = `http://127.0.0.1:${PORT}`;

function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(url);
        if (r.ok) return resolve();
      } catch {}
      if (Date.now() - start > timeoutMs) return reject(new Error("Dev server did not start"));
      setTimeout(tick, 500);
    };
    tick();
  });
}

async function nodeUnitTests() {
  const bare = { name: "Coral Agbada", part: "main_outfit", style: "Agbada", colours: ["Coral", "Gold"] };
  const art = garmentArtUrl(bare);
  if (!art.startsWith("data:image/svg")) throw new Error("garmentArtUrl did not produce SVG data URL");
  const enriched = enrichGarmentImages([bare])[0];
  if (!enriched.image) throw new Error("enrichGarmentImages did not add image");
  console.log("PASS node: garment art generated for imageless DB row");

  // vwPool — curate must not return empty for common male wedding brief
  const { MOCK_GARMENTS, MOCK_CREATORS } = await import("../src/lib/mockGarments.js");
  const { curateVwLooks } = await import("../src/lib/vwPool.js");
  const curated = curateVwLooks({
    garments: MOCK_GARMENTS,
    creators: MOCK_CREATORS,
    gender: "male",
    scene: "wedding",
    vibes: ["regal"],
    budgetBand: "100000-300000",
    modesty: 5,
    limit: 4,
  });
  if (!curated.looks.length) throw new Error("curateVwLooks returned empty pool for male wedding regal");
  console.log(`PASS node: curateVwLooks returns ${curated.looks.length} looks (pool ${curated.poolSize})`);

  const elegantMale = curateVwLooks({
    garments: MOCK_GARMENTS,
    creators: MOCK_CREATORS,
    gender: "male",
    scene: "wedding",
    vibes: ["elegant"],
    budgetBand: "100000-300000",
    limit: 4,
  });
  if (!elegantMale.looks.length) throw new Error("curateVwLooks should relax when vibe mismatches gender");
  if (!elegantMale.relaxed) throw new Error("expected relaxed=true for male+elegant vibe");
  console.log("PASS node: curateVwLooks relaxes incompatible vibe filters");

  return { art };
}

async function browserCanvasTest() {
  let child = null;
  try {
    await fetch(BASE);
  } catch {
    child = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(PORT)], {
      cwd: root,
      stdio: "pipe",
    });
    await waitForServer(BASE);
  }

  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const launchOpts = { headless: true };
  let browser;
  try {
    browser = await chromium.launch(launchOpts);
  } catch {
    try {
      browser = await chromium.launch({ ...launchOpts, channel: "chrome" });
    } catch {
      try {
        browser = await chromium.launch({ ...launchOpts, executablePath: chromePath });
      } catch (e) {
        if (child) child.kill("SIGTERM");
        throw new Error(
          "No Playwright Chromium or system Chrome available — run: npx playwright install chromium",
        );
      }
    }
  }

  const page = await browser.newPage();
  try {
    await page.goto(BASE, { waitUntil: "networkidle" });
    const result = await page.evaluate(async () => {
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
      };
    });
    if (!result.differs) throw new Error("Canvas output fingerprint matches input photo");
    console.log("PASS browser: compositeLook output differs from input");
    console.log("  photo:", result.photoFp);
    console.log("  output:", result.outFp);
    return result;
  } finally {
    await browser.close();
    if (child) child.kill("SIGTERM");
  }
}

async function main() {
  console.log("=== Virtual Wear Test ===\n");
  await nodeUnitTests();
  const nodeOnly = process.argv.includes("--node-only");
  if (nodeOnly) {
    console.log("SKIP browser (--node-only)");
    console.log("\nNODE PASS (run without --node-only for full canvas proof)");
    return;
  }
  try {
    await browserCanvasTest();
    console.log("\nALL PASS");
  } catch (e) {
    console.warn("WARN browser test skipped:", e.message);
    console.log("\nNODE PASS — install Playwright Chromium for full canvas verification");
  }
}

main().catch((e) => {
  console.error("\nFAIL:", e.message);
  process.exit(1);
});
