#!/usr/bin/env node
/**
 * Supabase Tester — local mock of Supabase REST, Auth, Storage, and Edge Functions.
 * Mimics what MyYanga v4 actually calls so Production mode runs without cloud Supabase.
 */
import http from "http";
import { BASE_URL, PORT, HOST, ANON_KEY, SERVICE_ROLE_KEY } from "./config.mjs";
import { loadDb } from "./db.mjs";
import { handleAuth, handleRest, handleStorage, corsHeaders } from "./handlers.mjs";
import { handleFunction } from "./functions.mjs";

loadDb();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE_URL);

  const respond = async (response) => {
    res.writeHead(response.status, Object.fromEntries(response.headers));
    const body = await response.arrayBuffer();
    res.end(Buffer.from(body));
  };

  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    // Health
    if (url.pathname === "/" || url.pathname === "/health") {
      await respond(
        new Response(
          JSON.stringify({
            service: "supabase-tester",
            version: "1.0.0",
            url: BASE_URL,
            anon_key: ANON_KEY.slice(0, 20) + "…",
          }),
          { headers: { "Content-Type": "application/json", ...corsHeaders() } },
        ),
      );
      return;
    }

    if (url.pathname.startsWith("/auth/v1")) {
      await respond(await handleAuth(req, url));
      return;
    }

    if (url.pathname.startsWith("/rest/v1")) {
      await respond(await handleRest(req, url));
      return;
    }

    if (url.pathname.startsWith("/storage/v1")) {
      await respond(await handleStorage(req, url));
      return;
    }

    if (url.pathname.startsWith("/functions/v1/")) {
      const fnName = url.pathname.replace("/functions/v1/", "").split("/")[0];
      await respond(await handleFunction(fnName, req));
      return;
    }

    await respond(new Response(JSON.stringify({ error: "not found", path: url.pathname }), { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders() } }));
  } catch (e) {
    console.error("[supabase-tester]", e);
    res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders() });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Supabase Tester listening on ${BASE_URL}`);
  console.log(`  ANON_KEY=${ANON_KEY.slice(0, 24)}…`);
  console.log(`  SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY.slice(0, 24)}…`);
  console.log(`  Tester login: tester@myyanga.test / Test2026!`);
});

process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
