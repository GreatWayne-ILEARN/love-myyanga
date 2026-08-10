import { createHash, randomBytes } from "crypto";
import { signJwt, userToken, verifyJwt } from "./jwt.mjs";
import {
  loadDb,
  saveDb,
  getUserByEmail,
  getUserById,
  ensureUser,
  getProfile,
  getFeatureGate,
  table,
  nextId,
} from "./db.mjs";
import { WA_EXPOSE_OTP } from "./config.mjs";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-upsert, prefer",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  };
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json", ...extra },
  });
}

function readBodyBuffer(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(Buffer.alloc(0)));
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

async function parseBody(req) {
  if (typeof req.json === "function") return req.json().catch(() => ({}));
  return readBody(req);
}

function authUser(req) {
  const auth = req.headers?.authorization || req.headers?.Authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const payload = verifyJwt(token);
  if (!payload?.sub) return null;
  return getUserById(payload.sub);
}

function sessionResponse(user) {
  const access_token = userToken(user);
  const refresh_token = signJwt({ sub: user.id, type: "refresh" }, 86400 * 30);
  return {
    access_token,
    refresh_token,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: user.id,
      email: user.email,
      role: "authenticated",
      user_metadata: user.user_metadata || {},
      app_metadata: user.app_metadata || {},
      email_confirmed_at: user.email_confirmed_at,
    },
  };
}

export async function handleAuth(req, url) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });

  const path = url.pathname.replace(/^\/auth\/v1/, "");

  if (path === "/signup" && req.method === "POST") {
    const body = await parseBody(req);
    const email = String(body.email || "").toLowerCase();
    if (!email) return json({ error: "email required" }, 400);
    const existing = getUserByEmail(email);
    if (existing) return json({ error: "User already registered" }, 400);
    const user = ensureUser({
      email,
      password: body.password,
      metadata: body.data || {},
    });
    return json(sessionResponse(user));
  }

  if (path === "/token" && req.method === "POST") {
    const grant = url.searchParams.get("grant_type");
    const body = await parseBody(req);
    if (grant === "password") {
      const user = getUserByEmail(body.email);
      if (!user || user.password !== body.password) {
        return json({ error: "Invalid login credentials", error_description: "Invalid login credentials" }, 400);
      }
      return json(sessionResponse(user));
    }
    if (grant === "refresh_token") {
      const payload = verifyJwt(body.refresh_token);
      const user = payload?.sub ? getUserById(payload.sub) : null;
      if (!user) return json({ error: "Invalid refresh token" }, 401);
      return json(sessionResponse(user));
    }
    return json({ error: "unsupported_grant_type" }, 400);
  }

  if (path === "/otp" && req.method === "POST") {
    const body = await parseBody(req);
    const email = String(body.email || "").toLowerCase();
    const user = ensureUser({ email, metadata: body.data || {} });
    const db = loadDb();
    const token_hash = createHash("sha256").update(`${email}:${Date.now()}`).digest("hex");
    db.magic_links[token_hash] = { email, user_id: user.id, expires: Date.now() + 3600000 };
    saveDb();
    // Tester: instant magic link — client can verify with token_hash
    return json({ message: "Magic link sent (tester: use verify endpoint)" });
  }

  if (path === "/verify" && req.method === "POST") {
    const body = await parseBody(req);
    const db = loadDb();
    if (body.type === "magiclink" && body.token_hash) {
      const link = db.magic_links[body.token_hash];
      if (!link || Date.now() > link.expires) {
        return json({ error: "Token has expired or is invalid" }, 400);
      }
      delete db.magic_links[body.token_hash];
      const user = getUserById(link.user_id);
      if (!user) return json({ error: "User not found" }, 400);
      return json(sessionResponse(user));
    }
    if (body.type === "email" && body.email && body.token) {
      const user = getUserByEmail(body.email);
      if (!user) return json({ error: "Invalid token" }, 400);
      return json(sessionResponse(user));
    }
    return json({ error: "unsupported verification type" }, 400);
  }

  if (path === "/user" && req.method === "GET") {
    const user = authUser(req);
    if (!user) return json({ error: "JWT expired" }, 401);
    return json({
      id: user.id,
      email: user.email,
      role: "authenticated",
      user_metadata: user.user_metadata || {},
      app_metadata: user.app_metadata || {},
    });
  }

  if (path === "/logout" && req.method === "POST") {
    return json({});
  }

  // OAuth authorize redirect mock — return to app with hash tokens
  if (path.startsWith("/authorize") && req.method === "GET") {
    const redirect = url.searchParams.get("redirect_to") || "/";
    const user = getUserByEmail("oadeagbo@gmail.com");
    const sess = sessionResponse(user);
    const hash = new URLSearchParams({
      access_token: sess.access_token,
      refresh_token: sess.refresh_token,
      expires_in: String(sess.expires_in),
      token_type: "bearer",
      type: "signup",
    }).toString();
    return Response.redirect(`${redirect}#${hash}`, 302);
  }

  return json({ error: "not found", path }, 404);
}

export async function handleRpc(name, body, userId) {
  const db = loadDb();
  switch (name) {
    case "get_feature_gate":
      return getFeatureGate(body.p_feature, userId);
    case "admin_analytics":
      return {
        users: db.profiles.length,
        creators: db.creators.filter((c) => c.is_active).length,
        garments: db.garments.filter((g) => g.is_active).length,
        looks: db.looks.length,
        pyl_entries: db.pyl_entries.length,
        payments_30d: 0,
        premium_subs: 0,
      };
    case "admin_fashion_analytics":
      return { events: db.analytics_events.length, days: body.p_days || 30 };
    case "vote_pyl": {
      const entry = db.pyl_entries.find((e) => e.id === body.p_entry);
      if (entry) entry.votes = (entry.votes || 0) + 1;
      saveDb();
      return { ok: true, votes: entry?.votes || 0 };
    }
    case "claim_founding_owner": {
      const profile = db.profiles.find((p) => p.id === userId);
      if (profile?.email?.toLowerCase() === "oadeagbo@gmail.com") {
        profile.is_owner = true;
        profile.role = "owner";
        saveDb();
        return { ok: true, claimed: true };
      }
      return { ok: false, error: "not_founding_email" };
    }
    case "list_access_directory":
      return {
        owners: db.profiles.filter((p) => p.is_owner),
        co_owners: db.platform_co_owners,
        admins: db.profiles.filter((p) => p.role === "admin"),
      };
    case "transfer_super_admin":
    case "add_co_owner":
    case "remove_co_owner":
    case "grant_privileges":
    case "revoke_privileges":
      return { ok: true, tester: true, action: name };
    case "delete_selected_records": {
      const t = body.target;
      const ids = body.ids || [];
      if (db[t]) {
        db[t] = db[t].filter((r) => !ids.includes(r.id));
        saveDb();
      }
      return { ok: true, deleted: ids.length };
    }
    case "delete_all_records": {
      const t = body.target;
      if (db[t]) {
        db[t] = [];
        saveDb();
      }
      return { ok: true };
    }
    case "fulfil_payment":
      return { ok: true, feature: body.p_reference, tester: true };
    default:
      return { error: `RPC ${name} not implemented in tester` };
  }
}

function coerce(val) {
  if (val === "true") return true;
  if (val === "false") return false;
  if (val === "null") return null;
  const n = Number(val);
  return Number.isNaN(n) ? val : n;
}

function applyFilters(rows, searchParams) {
  let out = [...rows];
  for (const [key, val] of searchParams) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    if (val.startsWith("eq.")) {
      const v = coerce(val.slice(3));
      out = out.filter((r) => r[key] === v || String(r[key]) === String(v));
      continue;
    }
    if (val.startsWith("gte.")) {
      const v = Number(val.slice(4));
      out = out.filter((r) => Number(r[key]) >= v);
      continue;
    }
    if (val.startsWith("lte.")) {
      const v = Number(val.slice(4));
      out = out.filter((r) => Number(r[key]) <= v);
      continue;
    }
    if (val.startsWith("cs.{")) {
      const needle = val.slice(4, -1).split(",").map((x) => x.trim());
      out = out.filter((r) => {
        const arr = r[key] || [];
        return needle.every((n) => arr.includes(n));
      });
    }
  }
  const order = searchParams.get("order");
  if (order) {
    const [col, dir] = order.split(".");
    out.sort((a, b) => {
      const cmp = a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0;
      return dir === "desc" ? -cmp : cmp;
    });
  }
  const limit = searchParams.get("limit");
  if (limit) out = out.slice(0, Number(limit));
  return out;
}

function embedCreator(rows, select) {
  if (!select?.includes("creator:")) return rows;
  const db = loadDb();
  return rows.map((g) => ({
    ...g,
    creator: db.creators.find((c) => c.id === g.creator_id) || null,
  }));
}

export async function handleRest(req, url) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });

  const parts = url.pathname.replace(/^\/rest\/v1\//, "").split("/");
  const tableName = parts[0];

  if (tableName === "rpc" && parts[1]) {
    const rpcName = parts[1];
    const body = await parseBody(req);
    const user = authUser(req);
    const result = await handleRpc(rpcName, body, user?.id);
    return json(result);
  }

  const db = loadDb();
  let rows = db[tableName] || [];
  const user = authUser(req);

  if (req.method === "GET") {
    rows = applyFilters(rows, url.searchParams);
    const select = url.searchParams.get("select") || "*";
    if (tableName === "garments") rows = embedCreator(rows, select);
    return json(rows);
  }

  if (req.method === "POST") {
    const body = await parseBody(req);
    const items = Array.isArray(body) ? body : [body];
    const inserted = items.map((item) => {
      const row = { ...item, id: item.id || nextId(tableName) };
      if (tableName === "looks" && user) row.user_id = row.user_id || user.id;
      if (tableName === "profiles" && !row.id && user) row.id = user.id;
      rows.push(row);
      db[tableName] = rows;
      return row;
    });
    saveDb();
    const prefer = req.headers?.prefer || req.headers?.Prefer || "";
    if (prefer.includes("return=representation")) return json(inserted.length === 1 ? inserted[0] : inserted, 201);
    return new Response(null, { status: 201, headers: corsHeaders() });
  }

  if (req.method === "PATCH") {
    const body = await parseBody(req);
    const idFilter = [...url.searchParams.entries()].find(([k]) => k === "id" || k.endsWith(".eq"));
    let targetId = null;
    for (const [k, v] of url.searchParams) {
      if (k === "id" && v.startsWith("eq.")) targetId = v.slice(3);
      if (k.endsWith(".eq") && !targetId) targetId = v;
    }
    rows = rows.map((r) => (String(r.id) === String(targetId) ? { ...r, ...body } : r));
    db[tableName] = rows;
    saveDb();
    return json(rows.find((r) => String(r.id) === String(targetId)) || {});
  }

  if (req.method === "DELETE") {
    const before = rows.length;
    for (const [k, v] of url.searchParams) {
      if (k.endsWith(".eq")) {
        const col = k.replace(".eq", "");
        rows = rows.filter((r) => String(r[col]) !== v);
      }
    }
    db[tableName] = rows;
    saveDb();
    return new Response(null, { status: before !== rows.length ? 204 : 404, headers: corsHeaders() });
  }

  return json({ error: "method not allowed" }, 405);
}

// Storage: in-memory blobs keyed by bucket/path
const storage = new Map();

export async function handleStorage(req, url) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });

  const path = url.pathname.replace(/^\/storage\/v1\//, "");

  if (path.startsWith("object/sign/") && req.method === "POST") {
    const rest = path.replace("object/sign/", "");
    const [bucket, ...parts] = rest.split("/");
    const objectPath = parts.join("/");
    const key = `${bucket}/${objectPath}`;
    if (!storage.has(key)) {
      // Allow sign even if not uploaded yet (tester leniency)
      storage.set(key, { mime: "image/jpeg", data: "" });
    }
    const signedURL = `/object/sign/${bucket}/${objectPath}?token=tester`;
    return json({ signedURL, path: objectPath });
  }

  if (path.startsWith("object/") && req.method === "POST" && !path.startsWith("object/sign/")) {
    const rest = path.replace("object/", "");
    const [bucket, ...parts] = rest.split("/");
    const objectPath = parts.join("/");
    const buf = await readBodyBuffer(req);
    const key = `${bucket}/${objectPath}`;
    storage.set(key, {
      mime: req.headers["content-type"] || req.headers["Content-Type"] || "image/jpeg",
      data: buf.toString("base64"),
    });
    return json({ Key: objectPath, path: objectPath });
  }

  if (path.startsWith("object/") && req.method === "GET") {
    const rest = path.replace("object/", "");
    const [bucket, ...parts] = rest.split("/");
    const objectPath = parts.join("/");
    const key = `${bucket}/${objectPath}`;
    const obj = storage.get(key);
    if (!obj) return json({ error: "not found" }, 404);
    const buf = Buffer.from(obj.data, "base64");
    return new Response(buf, {
      headers: { ...corsHeaders(), "Content-Type": obj.mime },
    });
  }

  return json({ error: "storage route not found" }, 404);
}

export function getStorageObject(bucket, objectPath) {
  return storage.get(`${bucket}/${objectPath}`);
}

export { storage, authUser, json, corsHeaders, parseBody };
