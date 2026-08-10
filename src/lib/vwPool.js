/**
 * Virtual Wear paid brand pool — randomized outfits.
 * Brands in the pool = creators.is_promoted (paid promotion / VW seat).
 * Event theme + outfit type (style) are required match dimensions.
 * Outfits already rendered for this device/user are never repeated until the pool resets.
 */
import { getAnonDeviceId } from "./analytics.js";
import { PRICE_BANDS } from "./catalog.js";

/** Lovable-style vibe → garment style mapping */
export const VW_VIBE_OPTIONS = [
  { id: "elegant", label: "Elegant", styles: ["Gown", "Lace", "Aso-Oke"] },
  { id: "bold", label: "Bold & colourful", styles: ["Ankara", "Aso-Oke"] },
  { id: "regal", label: "Regal", styles: ["Agbada", "Senator"] },
  { id: "modern", label: "Modern", styles: ["Two-piece", "Kaftan"] },
  { id: "traditional", label: "Traditional", styles: ["Agbada", "Aso-Oke", "Senator"] },
];

export const VW_AGE_GROUPS = [
  { id: "18-25", label: "18–25" },
  { id: "26-35", label: "26–35" },
  { id: "36-45", label: "36–45" },
  { id: "46+", label: "46+" },
];

const WORN_KEY = "myyanga_vw_worn_outfits";

/** Map VW scene → garment event_tags */
export const SCENE_TO_EVENT = {
  wedding: "wedding",
  corporate: "corporate",
  festival: "festival",
  date: "date",
  traditional: "traditional",
  casual: "casual",
  plain: null, // any event
};

export const VW_EVENT_SCENES = [
  { id: "wedding", label: "Wedding", event: "wedding" },
  { id: "festival", label: "Owambe / Festival", event: "festival" },
  { id: "corporate", label: "Corporate", event: "corporate" },
  { id: "traditional", label: "Traditional", event: "traditional" },
  { id: "date", label: "Date / Evening", event: "date" },
  { id: "casual", label: "Casual", event: "casual" },
];

function loadWorn() {
  try {
    return JSON.parse(localStorage.getItem(WORN_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveWorn(map) {
  try {
    localStorage.setItem(WORN_KEY, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

function wearerKey() {
  return getAnonDeviceId();
}

/** Outfit ids this wearer has already been rendered in. */
export function getWornOutfitIds() {
  const map = loadWorn();
  const row = map[wearerKey()] || { ids: [] };
  return new Set((row.ids || []).map(String));
}

export function markOutfitWorn(outfitId) {
  if (outfitId == null) return;
  const map = loadWorn();
  const k = wearerKey();
  const row = map[k] || { ids: [], at: {} };
  const id = String(outfitId);
  if (!row.ids.includes(id)) row.ids.push(id);
  row.at[id] = new Date().toISOString();
  // Cap history so localStorage stays small
  if (row.ids.length > 200) row.ids = row.ids.slice(-200);
  map[k] = row;
  saveWorn(map);
}

export function clearWornOutfits() {
  const map = loadWorn();
  delete map[wearerKey()];
  saveWorn(map);
}

/** Creators who paid into the Virtual Wear rotation pool. */
export function paidVwBrandIds(creators = []) {
  return new Set(
    (creators || [])
      .filter((c) => c.is_promoted || c.vw_pool_active)
      .map((c) => c.id),
  );
}

/**
 * Eligible main_outfit SKUs from the paid VW pool.
 * @param {object} opts
 * @param {array} opts.garments
 * @param {array} opts.creators
 * @param {string} opts.gender male|female
 * @param {string} opts.scene wedding|festival|…
 * @param {string} opts.style Agbada|Gown|… outfit type
 * @param {boolean} [opts.ignoreWorn] when pool exhausted, allow redraw
 */
export function eligibleVwOutfits({ garments, creators, gender, scene, style, ignoreWorn = false }) {
  const brandIds = paidVwBrandIds(creators);
  const worn = ignoreWorn ? new Set() : getWornOutfitIds();
  const event = SCENE_TO_EVENT[scene] ?? scene;

  return (garments || []).filter((g) => {
    if (!g || g.part !== "main_outfit") return false;
    if (!brandIds.has(g.creator_id)) return false;
    if (worn.has(String(g.id))) return false;
    if (gender) {
      if (g.gender && g.gender !== gender && g.gender !== "unisex") return false;
    }
    if (style && g.style && g.style !== style) return false;
    if (event) {
      const tags = g.event_tags || [];
      if (tags.length && !tags.includes(event)) return false;
    }
    return true;
  });
}

/** Fisher–Yates pick one. */
export function pickRandom(list) {
  if (!list?.length) return null;
  const i = Math.floor(Math.random() * list.length);
  return list[i];
}

/**
 * Pick next outfit for render. If all matching outfits are worn, resets worn
 * for this filter slice only by ignoring worn once (pool recycle).
 */
export function pickNextVwOutfit(opts) {
  let pool = eligibleVwOutfits(opts);
  let recycled = false;
  if (!pool.length) {
    pool = eligibleVwOutfits({ ...opts, ignoreWorn: true });
    recycled = pool.length > 0;
  }
  const outfit = pickRandom(pool);
  return { outfit, poolSize: pool.length, recycled };
}

/** Same-brand accessory: shoes or bag matching gender (optional event). */
export function pickAccessory(garments, { creatorId, gender, part, scene }) {
  const event = SCENE_TO_EVENT[scene] ?? scene;
  const candidates = (garments || []).filter((g) => {
    if (g.creator_id !== creatorId) return false;
    if (g.part !== part) return false;
    if (gender && g.gender && g.gender !== gender && g.gender !== "unisex") return false;
    if (event && g.event_tags?.length && !g.event_tags.includes(event)) return false;
    return true;
  });
  return pickRandom(candidates);
}

function stylesForModesty(level = 5) {
  const n = Number(level) || 5;
  if (n >= 8) return ["Agbada", "Kaftan", "Senator", "Aso-Oke"];
  if (n <= 3) return ["Gown", "Two-piece", "Lace"];
  return null;
}

function stylesForVibes(vibeIds = []) {
  if (!vibeIds?.length) return null;
  const set = new Set();
  for (const id of vibeIds) {
    const vibe = VW_VIBE_OPTIONS.find((v) => v.id === id);
    (vibe?.styles || []).forEach((s) => set.add(s));
  }
  return set.size ? [...set] : null;
}

function filterByBudget(outfits, budgetBandId) {
  if (!budgetBandId) return outfits;
  const band = PRICE_BANDS.find((b) => b.id === budgetBandId);
  if (!band) return outfits;
  return outfits.filter((g) => g.price_ngn >= band.min && g.price_ngn <= band.max);
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function assembleLookFromOutfit(outfit, garments, creators, gender, scene) {
  const shoe = pickAccessory(garments, { creatorId: outfit.creator_id, gender, part: "shoes", scene });
  const bag = pickAccessory(garments, { creatorId: outfit.creator_id, gender, part: "bag", scene });
  const items = [outfit, shoe, bag].filter(Boolean);
  const brand = (creators || []).find((c) => c.id === outfit.creator_id);
  return { outfit, shoe, bag, items, brand };
}

/**
 * Curate up to `limit` looks from the paid brand pool (client-side — no curate-looks edge).
 * Filters: gender, scene, vibes, budget, modesty. Respects worn-outfit rotation.
 */
export function curateVwLooks({
  garments,
  creators,
  gender,
  scene,
  style,
  vibes = [],
  budgetBand,
  modesty = 5,
  limit = 4,
}) {
  const vibeStyles = stylesForVibes(vibes);
  const modestyStyles = stylesForModesty(modesty);
  let styleFilter = style ? [style] : vibeStyles;
  if (modestyStyles) {
    styleFilter = styleFilter
      ? styleFilter.filter((s) => modestyStyles.includes(s))
      : modestyStyles;
    if (!styleFilter.length) styleFilter = modestyStyles;
  }

  let pool = [];
  let recycled = false;
  let relaxed = false;
  const stylesToTry = styleFilter?.length ? styleFilter : [null];

  function collectPool(ignoreWorn, styleList) {
    const list = [];
    for (const st of styleList) {
      const chunk = eligibleVwOutfits({
        garments,
        creators,
        gender,
        scene,
        style: st || undefined,
        ignoreWorn,
      });
      list.push(...chunk);
    }
    return filterByBudget([...new Map(list.map((g) => [g.id, g])).values()], budgetBand);
  }

  pool = collectPool(false, stylesToTry);

  if (!pool.length) {
    recycled = true;
    pool = collectPool(true, stylesToTry);
  }

  // Vibe/modesty styles may not match gender (e.g. Elegant → Gown for His). Relax style filter.
  if (!pool.length && styleFilter?.length) {
    relaxed = true;
    pool = collectPool(true, [null]);
  }

  const picked = [];
  const usedBrands = new Set();
  for (const outfit of shuffle(pool)) {
    if (picked.length >= limit) break;
    if (usedBrands.has(outfit.creator_id) && pool.length > limit) continue;
    usedBrands.add(outfit.creator_id);
    picked.push(assembleLookFromOutfit(outfit, garments, creators, gender, scene));
  }

  return { looks: picked, poolSize: pool.length, recycled, relaxed };
}

export function assembleRotatedLook({ garments, creators, gender, scene, style }) {
  const { outfit, poolSize, recycled } = pickNextVwOutfit({ garments, creators, gender, scene, style });
  if (!outfit) {
    return { ok: false, reason: "empty_pool", poolSize: 0 };
  }
  const assembled = assembleLookFromOutfit(outfit, garments, creators, gender, scene);
  return {
    ok: true,
    ...assembled,
    poolSize,
    recycled,
  };
}
