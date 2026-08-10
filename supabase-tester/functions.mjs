/**
 * Edge function mocks — mirror contracts from supabase/functions/*
 */
import { createHash } from "crypto";
import { BASE_URL, WA_EXPOSE_OTP } from "./config.mjs";
import {
  loadDb,
  saveDb,
  getFeatureGate,
  ensureUser,
  getUserByEmail,
} from "./db.mjs";
import { authUser, json, parseBody, getStorageObject } from "./handlers.mjs";
import { signJwt } from "./jwt.mjs";

const PRICE_BANDS = [
  { id: "0-100000", min: 0, max: 100000 },
  { id: "100000-300000", min: 100000, max: 300000 },
  { id: "300000-600000", min: 300000, max: 600000 },
  { id: "600000-99999999", min: 600000, max: 99999999 },
];

function asStringArray(singular, plural) {
  const out = [];
  if (typeof singular === "string" && singular.trim()) out.push(singular.trim());
  if (Array.isArray(plural)) {
    for (const x of plural) {
      if (typeof x === "string" && x.trim()) out.push(x.trim());
    }
  }
  return [...new Set(out)];
}

function colourHex(name) {
  const map = { coral: "#c45c48", gold: "#C9A227", navy: "#1f2a44", white: "#f0e6d2", emerald: "#0f6e63" };
  return map[String(name || "").toLowerCase()] || "#850713";
}

function garmentArtUrl(garment) {
  const colours = garment?.colours || [];
  const c1 = colourHex(colours[0]);
  const label = (garment?.name || garment?.style || "Garment").slice(0, 28);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320" viewBox="0 0 120 220"><rect width="120" height="220" fill="#1a0a08"/><path d="M45 25 L75 25 L95 55 L85 200 L35 200 L25 55 Z" fill="${c1}"/><text x="60" y="210" text-anchor="middle" font-family="Georgia,serif" font-size="9" fill="#f0d9b8">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function matchGarment(g, f) {
  if (!g) return false;
  if (f.gender && g.gender && g.gender !== f.gender && g.gender !== "unisex") return false;
  const countries = f.countries;
  if (countries?.length) {
    const country = g.country || g.creator?.country;
    if (!country || !countries.includes(country)) return false;
  }
  const events = f.events;
  if (events?.length) {
    const tags = g.event_tags || [];
    if (!events.some((e) => tags.includes(e))) return false;
  }
  const styles = f.styles;
  if (styles?.length && !styles.includes(g.style || "")) return false;
  const colours = f.colours;
  if (colours?.length) {
    const cols = g.colours || [];
    if (!colours.some((c) => cols.includes(c))) return false;
  }
  const parts = f.parts;
  if (parts?.length && !parts.includes(g.part || "")) return false;
  const priceBands = f.priceBands;
  if (priceBands?.length) {
    const bands = PRICE_BANDS.filter((b) => priceBands.includes(b.id));
    const price = g.price_ngn || 0;
    if (!bands.some((b) => price >= b.min && price <= b.max)) return false;
  }
  return true;
}

function buildDecks(rows) {
  const decks = [];
  const byStyle = new Map();
  for (const g of rows) {
    const k = g.style || "Look";
    if (!byStyle.has(k)) byStyle.set(k, []);
    byStyle.get(k).push(g);
  }
  for (const [styleName, items] of byStyle) {
    decks.push({
      title: `${styleName} look`,
      items: items.slice(0, 4),
      total_ngn: items.slice(0, 4).reduce((s, x) => s + (x.price_ngn || 0), 0),
    });
    if (decks.length >= 6) break;
  }
  return decks;
}

function parseDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  return m ? { mime: m[1], data: m[2] } : null;
}

/** Tester virtual try-on: tint + marker so output differs from input */
function mockTryOnImage(personB64, scene = "plain") {
  const buf = Buffer.from(personB64, "base64");
  // Append deterministic marker bytes so fingerprint always differs
  const marker = Buffer.from(`|tester-vto|${scene}|`);
  const out = Buffer.concat([buf, marker]);
  return `data:image/png;base64,${out.toString("base64")}`;
}

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return `+${digits.slice(1).replace(/\D/g, "")}`;
  const only = digits.replace(/\D/g, "");
  if (only.length === 11 && only.startsWith("0")) return `+234${only.slice(1)}`;
  if (only.length === 10 && /^[789]/.test(only)) return `+234${only}`;
  if (only.length >= 10) return `+${only}`;
  return "";
}

function waEmail(phone) {
  return `wa_${normalizePhone(phone).replace(/\D/g, "")}@auth.myyanga.app`;
}

export async function handleFunction(name, req) {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth && name !== "auth-whatsapp") {
    return json({ error: "Unauthorized" }, 401);
  }

  const user = authUser(req);
  if (!auth?.includes("anon") && !user && name !== "auth-whatsapp") {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await parseBody(req);
  const db = loadDb();

  switch (name) {
    case "smart-search": {
      const gate = getFeatureGate("smart_search", user?.id);
      if (!gate.access) return json({ error: "Payment required", gate }, 402);

      const events = asStringArray(body.event, body.events);
      const styles = asStringArray(body.style, body.styles);
      const colours = asStringArray(body.colour, body.colours);
      const countries = asStringArray(body.country, body.countries);
      const parts = asStringArray(body.part, body.parts);

      let rows = db.garments.filter((g) => g.is_active);
      if (body.gender) {
        rows = rows.filter((g) => !g.gender || g.gender === body.gender || g.gender === "unisex");
      }
      if (styles.length === 1) rows = rows.filter((g) => g.style === styles[0]);
      else if (styles.length > 1) rows = rows.filter((g) => styles.includes(g.style));

      const filterSpec = { gender: body.gender, countries, events, styles, colours, parts, priceBands: body.priceBands };
      rows = rows.filter((g) => matchGarment({ ...g, creator: db.creators.find((c) => c.id === g.creator_id) }, filterSpec));
      rows = rows.slice(0, Math.min(Number(body.limit) || 12, 30));
      rows = rows.map((g) => {
        if (!g.image && !g.card_image) return { ...g, image: garmentArtUrl(g), _art_generated: true };
        return g;
      });

      return json({ garments: rows, decks: buildDecks(rows), summary: "", count: rows.length });
    }

    case "virtual-tryon": {
      const gate = getFeatureGate("virtual_wear", user?.id);
      if (!gate.access) return json({ error: "Payment required", gate }, 402);

      let person = body.personImage ? parseDataUrl(body.personImage) : null;
      if (!person && body.selfieUrl) {
        const inline = parseDataUrl(body.selfieUrl);
        if (inline) person = inline;
      }
      if (!person && body.selfiePath) {
        const obj = getStorageObject("looks", body.selfiePath);
        if (obj?.data) person = { mime: obj.mime, data: obj.data };
      }
      if (!person) return json({ error: "personImage, selfieUrl, or selfiePath required" }, 400);

      const image = mockTryOnImage(person.data, body.scene || "plain");
      return json({ image, provider: "supabase-tester-mock", scene: body.scene || "plain" });
    }

    case "auth-whatsapp": {
      const action = body.action;
      const phone = normalizePhone(body.phone);
      if (!phone) return json({ error: "Valid phone required" }, 400);

      if (action === "request") {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        db.wa_challenges[phone] = { code, expires: Date.now() + 600000 };
        saveDb();

        if (!WA_EXPOSE_OTP) {
          return json({
            error: "WhatsApp Cloud not configured",
            detail: "Set WA_AUTH_EXPOSE_OTP=1 for tester",
          }, 503);
        }
        return json({
          ok: true,
          queued: false,
          sent: false,
          detail: "Staging OTP exposed — not sent via WhatsApp",
          code,
        });
      }

      if (action === "verify") {
        const ch = db.wa_challenges[phone];
        if (!ch || ch.code !== String(body.code || "").trim()) {
          return json({ error: "Invalid or expired code" }, 401);
        }
        delete db.wa_challenges[phone];
        const email = waEmail(phone);
        const u = ensureUser({ email, metadata: { phone, auth_provider: "whatsapp", full_name: `WA ${phone.slice(-4)}` } });
        const token_hash = createHash("sha256").update(`${email}:wa:${Date.now()}`).digest("hex");
        db.magic_links[token_hash] = { email, user_id: u.id, expires: Date.now() + 3600000 };
        saveDb();
        return json({ ok: true, email, token_hash, phone });
      }

      return json({ error: "Unknown action" }, 400);
    }

    case "payments": {
      if (body.action === "init") {
        const gate = getFeatureGate(body.feature, user?.id);
        if (gate.access || gate.mode === "free") return json({ access: true, mode: gate.mode || "free" });
        return json({ error: "Payment providers not configured in tester", tester: true }, 503);
      }
      if (body.action === "verify") {
        return json({ ok: true, tester: true, reference: body.reference });
      }
      return json({ error: "Unknown action" }, 400);
    }

    case "ai-chat":
      return json({ reply: "Supabase tester mock — configure ANTHROPIC_API_KEY on real edge for AI chat." });

    case "send-reel": {
      const channel = body.channel || "email";
      const to = body.to || user?.email;
      const reel = body.reel || { title: "MyYanga Reel", panes: [] };
      const reelUrl = body.reelUrl || `${BASE_URL}/?view=reels`;
      if (!to && channel !== "webpush") return json({ error: "to required" }, 400);

      const entry = {
        id: `tester_reel_${Date.now()}`,
        channel,
        to,
        reel_id: reel.id,
        reel_title: reel.title,
        panes: reel.panes?.length || 0,
        reelUrl,
        at: new Date().toISOString(),
        tester: true,
      };
      const db = loadDb();
      if (!db.reel_outbound) db.reel_outbound = [];
      db.reel_outbound.unshift(entry);
      saveDb();

      if (channel === "email") {
        return json({
          ok: true,
          provider: "tester_mock_resend",
          id: entry.id,
          message: `Tester mock email to ${to} (${reel.panes?.length || 0} panes)`,
          tester: true,
        });
      }
      if (channel === "whatsapp") {
        return json({
          ok: true,
          provider: "tester_mock_whatsapp",
          queued: false,
          id: entry.id,
          tester: true,
        });
      }
      if (channel === "webpush") {
        return json({
          ok: true,
          provider: "tester_mock_push",
          queued: true,
          endpoint: body.subscription?.endpoint,
          tester: true,
        });
      }
      return json({ ok: true, tester: true });
    }

    default:
      return json({ error: `Function ${name} not implemented` }, 404);
  }
}
