#!/usr/bin/env node
/**
 * Capture MyYangaX overview screenshots into docs/myangax-screenshots/
 * Serves dist/ locally. Run after `npm run build`.
 */
import { mkdirSync, existsSync, readFileSync, statSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs/myangax-screenshots");
mkdirSync(outDir, { recursive: true });

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function serveDist(port = 4188) {
  const dist = join(root, "dist");
  if (!existsSync(join(dist, "index.html"))) {
    throw new Error("dist/ missing — run npm run build first");
  }
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let path = (req.url || "/").split("?")[0];
      if (path === "/") path = "/index.html";
      let file = join(dist, path);
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, "index.html");
      try {
        const buf = readFileSync(file);
        res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
        res.end(buf);
      } catch {
        res.writeHead(404);
        res.end("missing");
      }
    });
    server.listen(port, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${port}` }));
  });
}

async function shot(page, name, opts = {}) {
  const file = join(outDir, name);
  await page.screenshot({ path: file, fullPage: !!opts.fullPage });
  console.log("SHOT", name);
  return name;
}

async function main() {
  const { chromium } = await import("playwright").catch(() => ({ chromium: null }));
  if (!chromium) {
    console.error("Playwright not installed");
    process.exit(1);
  }

  const { server, url } = await serveDist();
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const taken = [];

  const goto = async (path) => {
    await page.goto(url + path, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(700);
  };

  await goto("/");
  taken.push(await shot(page, "01-home-landing.png"));

  // Virtual Wear Lovable stages
  await goto("/?view=virtualwear");
  taken.push(await shot(page, "02-vw-lovable-landing.png"));

  try {
    const startBtn = page.getByRole("button", { name: /start styling/i }).first();
    if (await startBtn.count()) {
      await startBtn.click();
      await page.waitForTimeout(500);
      taken.push(await shot(page, "03-vw-questionnaire.png", { fullPage: true }));
    }
  } catch (e) {
    console.warn("vw-questionnaire", e.message);
  }

  await goto("/?view=smart");
  taken.push(await shot(page, "04-smart-search.png", { fullPage: true }));

  await goto("/?view=discover");
  taken.push(await shot(page, "05-discover-brands.png"));

  await goto("/?view=reels");
  taken.push(await shot(page, "06-reels-inbox.png"));

  await goto("/?view=settings");
  taken.push(await shot(page, "07-settings.png", { fullPage: true }));

  // Login modal
  try {
    await goto("/");
    await page.evaluate(() => localStorage.removeItem("myyanga_test_session"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    const loginBtn = page.getByRole("button", { name: /^Login$/i }).first();
    if (await loginBtn.count()) {
      await loginBtn.click();
      await page.waitForTimeout(500);
      taken.push(await shot(page, "08-auth-modal.png"));
      await page.keyboard.press("Escape").catch(() => {});
    }
  } catch (e) {
    console.warn("auth", e.message);
  }

  // Admin as founding owner
  try {
    await goto("/");
    await page.evaluate(() => {
      localStorage.setItem(
        "myyanga_test_session",
        JSON.stringify({
          id: "founding",
          email: "oadeagbo@gmail.com",
          name: "Olufemi Adeagbo",
          role: "owner",
          is_owner: true,
          privileges: ["brand_e_vetting", "content_studio", "monetization", "analytics"],
        }),
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    await goto("/?view=admin");
    taken.push(await shot(page, "09-admin-console.png"));

    const access = page.locator("text=Access Control").first();
    if (await access.count()) {
      await access.click();
      await page.waitForTimeout(600);
      taken.push(await shot(page, "10-admin-access-control.png"));
    }

    const mon = page.locator("text=Monetization").first();
    if (await mon.count()) {
      await mon.click();
      await page.waitForTimeout(600);
      taken.push(await shot(page, "11-admin-monetization.png"));
    }

    const evet = page.locator("text=E-vetting").first();
    if (await evet.count()) {
      await evet.click();
      await page.waitForTimeout(700);
      taken.push(await shot(page, "12-admin-evetting.png", { fullPage: true }));
    }
  } catch (e) {
    console.warn("admin", e.message);
  }

  await browser.close();
  server.close();
  console.log(`Done → docs/myangax-screenshots/ (${taken.length} shots)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
