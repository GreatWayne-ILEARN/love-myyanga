#!/usr/bin/env node
/**
 * QA smoke tests for Supabase Tester — mirrors hostile audit Tier 3 checks.
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { spawn } from "child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.supabase-tester");

function loadEnv() {
  if (!existsSync(envPath)) throw new Error(".env.supabase-tester missing");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
}

loadEnv();

const url = process.env.VITE_SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY;
const fnBase = url.replace(/\/$/, "") + "/functions/v1";
const failures = [];

function pass(name) {
  console.log(`PASS ${name}`);
}

function fail(name, reason) {
  failures.push({ name, reason });
  console.log(`FAIL ${name}: ${reason}`);
}

async function ensureTester() {
  try {
    const r = await fetch(`${url}/health`);
    if (r.ok) return null;
  } catch {}
  const child = spawn("node", ["supabase-tester/server.mjs"], { cwd: root, stdio: "pipe" });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const h = await fetch(`${url}/health`);
      if (h.ok) return child;
    } catch {}
  }
  throw new Error("Tester did not start");
}

function imageFingerprint(dataUrl) {
  if (!dataUrl) return "";
  const body = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  const slice = body.slice(0, 4000) + body.slice(-2000);
  let h = 0;
  for (let i = 0; i < slice.length; i++) h = (h * 31 + slice.charCodeAt(i)) >>> 0;
  return `${body.length}:${h}`;
}

async function main() {
  console.log("=== Supabase Tester QA ===\n");
  const child = await ensureTester();

  const ssNoAuth = await fetch(`${fnBase}/smart-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon },
    body: JSON.stringify({ gender: "male" }),
  });
  ssNoAuth.status === 401 ? pass("smart-search 401 without token") : fail("smart-search 401", `got ${ssNoAuth.status}`);

  const vtoNoAuth = await fetch(`${fnBase}/virtual-tryon`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon },
    body: JSON.stringify({ personImage: "data:image/png;base64,iVBORw0KGgo=" }),
  });
  vtoNoAuth.status === 401 ? pass("virtual-tryon 401 without token") : fail("virtual-tryon 401", `got ${vtoNoAuth.status}`);

  const waReq = await fetch(`${fnBase}/auth-whatsapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify({ action: "request", phone: "+2348012345678" }),
  });
  const waBody = await waReq.json();
  if (waReq.status === 200 && waBody.code) pass("auth-whatsapp exposes OTP");
  else fail("auth-whatsapp OTP", `HTTP ${waReq.status}`);

  const sb = createClient(url, anon);
  const { data: sess, error: signErr } = await sb.auth.signInWithPassword({
    email: process.env.AUDIT_TEST_EMAIL || "tester@myyanga.test",
    password: process.env.AUDIT_TEST_PASSWORD || "Test2026!",
  });
  if (signErr || !sess.session) fail("sign-in", signErr?.message || "no session");
  else pass(`sign-in ${sess.user.email}`);

  const token = sess.session.access_token;
  const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", apikey: anon };

  const ssBroad = await fetch(`${fnBase}/smart-search`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ gender: "male", limit: 30 }),
  });
  const ssBroadBody = await ssBroad.json();
  if (!ssBroad.ok) fail("smart-search broad", ssBroadBody.error);
  else {
    pass(`smart-search broad (${(ssBroadBody.garments || []).length} garments)`);
    const broadCount = ssBroadBody.garments.length;

    const ssCorp = await fetch(`${fnBase}/smart-search`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ gender: "male", events: ["corporate"], limit: 30 }),
    });
    const ssCorpBody = await ssCorp.json();
    const corpCount = (ssCorpBody.garments || []).length;
    corpCount <= broadCount ? pass("events[] narrows results") : fail("events filter", `${corpCount} > ${broadCount}`);

    const ssAgbada = await fetch(`${fnBase}/smart-search`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ gender: "male", styles: ["Agbada"], limit: 30 }),
    });
    const ssAgbadaBody = await ssAgbada.json();
    const agbada = ssAgbadaBody.garments || [];
    const allAgbada = agbada.every((g) => (g.style || "").toLowerCase() === "agbada");
    allAgbada ? pass(`styles:[Agbada] (${agbada.length} hits)`) : fail("styles filter", "non-Agbada returned");
  }

  const tinyPng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const vtoRes = await fetch(`${fnBase}/virtual-tryon`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      personImage: tinyPng,
      garments: [{ name: "Test Agbada", part: "main_outfit", style: "Agbada" }],
      scene: "wedding",
    }),
  });
  const vtoBody = await vtoRes.json();
  if (vtoRes.ok && vtoBody.image) {
    const differs = imageFingerprint(tinyPng) !== imageFingerprint(vtoBody.image);
    differs ? pass(`virtual-tryon output differs (${vtoBody.provider})`) : fail("virtual-tryon", "UNCHANGED IMAGE");
  } else {
    fail("virtual-tryon", vtoBody.error || `HTTP ${vtoRes.status}`);
  }

  const { data: gate } = await sb.rpc("get_feature_gate", { p_feature: "virtual_wear" });
  gate?.access ? pass("get_feature_gate access=true") : fail("feature gate", JSON.stringify(gate));

  const { data: garments } = await sb.from("garments").select("*").eq("is_active", true).limit(5);
  garments?.length ? pass(`garments CRUD read (${garments.length} rows)`) : fail("garments read", "empty");

  const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" });
  const path = `${sess.user.id}/selfies/qa-test.jpg`;
  const { error: upErr } = await sb.storage.from("looks").upload(path, blob);
  !upErr ? pass("storage upload") : fail("storage upload", upErr.message);

  const { data: signed, error: signUrlErr } = await sb.storage.from("looks").createSignedUrl(path, 3600);
  signed?.signedUrl ? pass("storage signed URL") : fail("storage sign", signUrlErr?.message || "no url");

  const reelRes = await fetch(`${fnBase}/send-reel`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      channel: "email",
      to: sess.user.email,
      reel: { id: "qa_reel", title: "QA Reel", panes: [{ title: "Look 1" }] },
      reelUrl: `${url}/?view=reels&reel=qa_reel`,
    }),
  });
  const reelBody = await reelRes.json();
  if (reelRes.ok && reelBody.ok && reelBody.provider) pass(`send-reel email (${reelBody.provider})`);
  else fail("send-reel", reelBody.error || `HTTP ${reelRes.status}`);

  console.log(`\n=== ${failures.length ? "FAIL" : "PASS"} (${failures.length} failures) ===`);
  if (child) child.kill("SIGTERM");
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
