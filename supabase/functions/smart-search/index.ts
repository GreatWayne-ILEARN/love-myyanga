// SmartSearch — multi-parameter garment search + optional AI narrative.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type GarmentRow = {
  id?: number;
  name?: string;
  part?: string;
  style?: string;
  event_tags?: string[];
  colours?: string[];
  categories?: string[];
  gender?: string;
  country?: string;
  price_ngn?: number;
  image?: string;
  card_image?: string;
  image_url?: string;
  is_premium?: boolean;
  creator?: { name?: string; country?: string; is_promoted?: boolean };
};

const PRICE_BANDS = [
  { id: "0-100000", min: 0, max: 100000 },
  { id: "100000-300000", min: 100000, max: 300000 },
  { id: "300000-600000", min: 300000, max: 600000 },
  { id: "600000-99999999", min: 600000, max: 99999999 },
];

const COLOUR_MAP: Record<string, string> = {
  coral: "#c45c48",
  gold: "#C9A227",
  navy: "#1f2a44",
  white: "#f0e6d2",
  emerald: "#0f6e63",
  burgundy: "#850713",
  charcoal: "#333333",
  ankara: "#c0392b",
  "aso-oke": "#6b2d5c",
  lace: "#e8d5f0",
};

function asStringArray(singular: unknown, plural: unknown): string[] {
  const out: string[] = [];
  if (typeof singular === "string" && singular.trim()) out.push(singular.trim());
  if (Array.isArray(plural)) {
    for (const x of plural) {
      if (typeof x === "string" && x.trim()) out.push(x.trim());
    }
  }
  return [...new Set(out)];
}

function colourHex(name?: string) {
  if (!name) return "#850713";
  const key = String(name).toLowerCase().replace(/\s+/g, "-");
  return COLOUR_MAP[key] || COLOUR_MAP[name.toLowerCase()] || "#850713";
}

function garmentArtUrl(garment: GarmentRow) {
  const colours = garment?.colours || [];
  const c1 = colourHex(colours[0]);
  const c2 = colourHex(colours[1] || colours[0]);
  const part = garment?.part || "main_outfit";
  const style = String(garment?.style || "").toLowerCase();
  let body = `<path d="M45 25 L75 25 L95 55 L85 200 L35 200 L25 55 Z" fill="${c1}"/>`;
  if (part === "shoes") {
    body = `<ellipse cx="35" cy="90" rx="28" ry="12" fill="${c1}"/><ellipse cx="85" cy="90" rx="28" ry="12" fill="${c1}"/>`;
  } else if (style.includes("agbada") || style.includes("senator")) {
    body = `<path d="M40 30 L80 30 L110 70 L100 200 L20 200 L10 70 Z" fill="${c1}"/>`;
  }
  const label = (garment?.name || garment?.style || "Garment").slice(0, 28);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320" viewBox="0 0 120 220"><rect width="120" height="220" fill="#1a0a08"/>${body}<text x="60" y="210" text-anchor="middle" font-family="Georgia,serif" font-size="9" fill="#f0d9b8">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function enrichGarmentImages(garments: GarmentRow[]) {
  return garments.map((g) => {
    if (!g?.image && !g?.card_image && !g?.image_url) {
      return { ...g, image: garmentArtUrl(g), _art_generated: true };
    }
    return g;
  });
}

function matchGarment(g: GarmentRow, f: Record<string, unknown>) {
  if (!g) return false;

  const gender = f.gender as string | undefined;
  if (gender) {
    if (g.gender && g.gender !== gender && g.gender !== "unisex") return false;
  }

  const categories = f.categories as string[] | undefined;
  if (categories?.length) {
    const cats = g.categories || [];
    if (!categories.some((c) => cats.includes(c) || g.style === c || g.part === c)) return false;
  }

  const countries = f.countries as string[] | undefined;
  if (countries?.length) {
    const country = g.country || g.creator?.country;
    if (!country || !countries.includes(country)) return false;
  }

  const events = f.events as string[] | undefined;
  if (events?.length) {
    const tags = g.event_tags || [];
    if (!events.some((e) => tags.includes(e))) return false;
  }

  const styles = f.styles as string[] | undefined;
  if (styles?.length && !styles.includes(g.style || "")) return false;

  const colours = f.colours as string[] | undefined;
  if (colours?.length) {
    const cols = g.colours || [];
    if (!colours.some((c) => cols.includes(c))) return false;
  }

  const parts = f.parts as string[] | undefined;
  if (parts?.length && !parts.includes(g.part || "")) return false;

  const priceBands = f.priceBands as string[] | undefined;
  if (priceBands?.length) {
    const bands = PRICE_BANDS.filter((b) => priceBands.includes(b.id));
    const price = g.price_ngn || 0;
    if (!bands.some((b) => price >= b.min && price <= b.max)) return false;
  }

  const lo = f.budgetMin ? Number(f.budgetMin) : null;
  const hi = f.budgetMax ? Number(f.budgetMax) : null;
  const price = g.price_ngn || 0;
  if (lo != null && !Number.isNaN(lo) && price < lo) return false;
  if (hi != null && !Number.isNaN(hi) && price > hi) return false;

  if (f.promotedOnly && !g.is_premium && !g.creator?.is_promoted) return false;

  const query = f.query as string | undefined;
  if (query) {
    const needle = String(query).toLowerCase();
    const hay = `${g.name || ""} ${g.style || ""} ${g.creator?.name || ""} ${(g.categories || []).join(" ")}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }

  return true;
}

function buildDeckItems(pool: GarmentRow[]) {
  const parts = ["head_piece", "main_outfit", "shoes", "jewellery", "bag"];
  const byPart: Record<string, GarmentRow> = {};
  for (const p of parts) {
    const match = pool.find((g) => g.part === p) || pool.find((g) => g.part === "main_outfit");
    if (match && !byPart[p]) byPart[p] = match;
  }
  const items = Object.values(byPart);
  if (!items.length && pool.length) return pool.slice(0, Math.min(4, pool.length));
  if (items.length === 1 && pool.length > 1) {
    const extra = pool.find((g) => !items.includes(g));
    if (extra) items.push(extra);
  }
  return items;
}

function buildDecks(rows: GarmentRow[]) {
  const decks: { title: string; items: GarmentRow[]; total_ngn: number }[] = [];
  const mainOutfits = rows.filter((r) => r.part === "main_outfit");
  const accessories = rows.filter((r) => r.part !== "main_outfit");
  const seedRows = mainOutfits.length ? mainOutfits : rows;

  const byStyle = new Map<string, GarmentRow[]>();
  for (const g of seedRows) {
    const k = g.style || "Look";
    if (!byStyle.has(k)) byStyle.set(k, []);
    byStyle.get(k)!.push(g);
  }

  for (const [styleName, items] of byStyle) {
    const pool = [...items, ...accessories];
    const deckItems = buildDeckItems(pool.slice(0, 8));
    if (!deckItems.length) continue;
    decks.push({
      title: `${styleName} look`,
      items: deckItems,
      total_ngn: deckItems.reduce((s, x) => s + (x.price_ngn || 0), 0),
    });
    if (decks.length >= 8) break;
  }

  if (!decks.length && rows.length) {
    const pick = rows.slice(0, 5);
    decks.push({
      title: "Matched pieces",
      items: pick,
      total_ngn: pick.reduce((s, x) => s + (x.price_ngn || 0), 0),
    });
  }

  return decks.slice(0, 6);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const auth = req.headers.get("Authorization");
  if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: gate } = await admin.rpc("get_feature_gate", { p_feature: "smart_search" });
  if (!gate?.access) {
    return new Response(JSON.stringify({ error: "Payment required", gate }), { status: 402, headers: cors });
  }

  const body = await req.json().catch(() => ({}));
  const {
    event,
    style,
    colour,
    events: eventsBody,
    styles: stylesBody,
    colours: coloursBody,
    categories: categoriesBody,
    category,
    countries: countriesBody,
    country,
    parts: partsBody,
    part,
    priceBands,
    gender,
    budgetMin,
    budgetMax,
    promotedOnly,
    query,
    limit = 12,
  } = body as Record<string, unknown>;

  const events = asStringArray(event, eventsBody);
  const styles = asStringArray(style, stylesBody);
  const colours = asStringArray(colour, coloursBody);
  const categories = asStringArray(category, categoriesBody);
  const countries = asStringArray(country, countriesBody);
  const parts = asStringArray(part, partsBody);

  let q = admin
    .from("garments")
    .select("*, creator:creators(id,name,credibility_score,is_promoted,country)")
    .eq("is_active", true);

  if (gender && typeof gender === "string") {
    q = q.or(`gender.eq.${gender},gender.eq.unisex,gender.is.null`);
  }
  if (styles.length === 1) q = q.eq("style", styles[0]);
  else if (styles.length > 1) q = q.in("style", styles);
  if (colours.length) q = q.overlaps("colours", colours);
  if (events.length) q = q.overlaps("event_tags", events);
  if (parts.length === 1) q = q.eq("part", parts[0]);
  else if (parts.length > 1) q = q.in("part", parts);
  if (budgetMin) q = q.gte("price_ngn", Number(budgetMin));
  if (budgetMax) q = q.lte("price_ngn", Number(budgetMax));
  if (promotedOnly) q = q.eq("is_premium", true);

  const fetchLimit = Math.min(Math.max(Number(limit) || 12, 12) * 4, 120);
  const { data: garments, error } = await q.limit(fetchLimit);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });

  const filterSpec = {
    gender,
    categories,
    countries,
    events,
    styles,
    colours,
    parts,
    priceBands,
    budgetMin,
    budgetMax,
    promotedOnly,
    query,
  };

  let rows = (garments ?? []).filter((g) => matchGarment(g as GarmentRow, filterSpec));
  rows = rows.slice(0, Math.min(Number(limit) || 12, 30));
  rows = enrichGarmentImages(rows as GarmentRow[]);

  const decks = buildDecks(rows as GarmentRow[]);

  const summaryParts = [
    events.length ? `events: ${events.join(", ")}` : "",
    styles.length ? `styles: ${styles.join(", ")}` : "",
    colours.length ? `colours: ${colours.join(", ")}` : "",
  ].filter(Boolean);

  let summary = "";
  const aiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (aiKey && query) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": aiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: `You are MyYanga fashion stylist. User wants: ${query}. Filters: ${summaryParts.join("; ") || "any"}. Budget: ${budgetMin || 0}-${budgetMax || "open"} NGN. Found ${rows.length} garments in ${decks.length} look decks. Write 2 sentences of styling advice.`,
          },
        ],
      }),
    });
    const d = await r.json();
    summary = d?.content?.[0]?.text || "";
  }

  return new Response(JSON.stringify({ garments: rows, decks, summary, count: rows.length }), { headers: cors });
});
