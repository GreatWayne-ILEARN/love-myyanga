/**
 * In-memory DB seeded from production migrations + 006_seed_production.
 * Persists to supabase-tester/.data/store.json between runs.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import {
  FOUNDING_EMAIL,
  TESTER_EMAIL,
  TESTER_PASSWORD,
  UNLOCK_ALL_GATES,
} from "./config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), ".data");
const storePath = join(root, "store.json");

const IDS = {
  founding: "22222222-2222-2222-2222-222222222222",
  tester: "11111111-1111-1111-1111-111111111111",
  demo: "33333333-3333-3333-3333-333333333333",
};

function defaultStore() {
  const creators = [
    { id: 1, name: "Maki Oh", slug: "maki-oh", discipline: "fashion", city: "Lagos", country: "Nigeria", credibility_score: 95, is_promoted: true, promotion_kind: "credibility", is_active: true },
    { id: 2, name: "Mai Atafo", slug: "mai-atafo", discipline: "fashion", city: "Lagos", country: "Nigeria", credibility_score: 92, is_promoted: true, promotion_kind: "credibility", is_active: true },
    { id: 3, name: "Andrea Iyamah", slug: "andrea-iyamah", discipline: "fashion", city: "Lagos", country: "Nigeria", credibility_score: 90, is_promoted: true, promotion_kind: "credibility", is_active: true },
    { id: 4, name: "Tubo", slug: "tubo", discipline: "fashion", city: "Lagos", country: "Nigeria", credibility_score: 88, is_promoted: true, promotion_kind: "paid", is_active: true },
    { id: 5, name: "Orange Culture", slug: "orange-culture", discipline: "fashion", city: "Lagos", country: "Nigeria", credibility_score: 85, is_promoted: false, is_active: true },
    { id: 6, name: "Emmy Kasbit", slug: "emmy-kasbit", discipline: "fashion", city: "Lagos", country: "Nigeria", credibility_score: 84, is_promoted: false, is_active: true },
    { id: 7, name: "Lisa Folawiyo", slug: "lisa-folawiyo", discipline: "fashion", city: "Lagos", country: "Nigeria", credibility_score: 91, is_promoted: true, promotion_kind: "credibility", is_active: true },
    { id: 8, name: "Deola Sagoe", slug: "deola-sagoe", discipline: "fashion", city: "Lagos", country: "Nigeria", credibility_score: 93, is_promoted: true, promotion_kind: "credibility", is_active: true },
  ];

  const garmentRows = [
    { creator_id: 1, name: "Coral Agbada Set", part: "main_outfit", style: "Agbada", event_tags: ["wedding", "festival", "traditional"], colours: ["Coral", "Gold"], gender: "male", price_ngn: 285000, is_premium: true },
    { creator_id: 1, name: "Royal Lace Gown", part: "main_outfit", style: "Gown", event_tags: ["wedding", "evening"], colours: ["White", "Gold"], gender: "female", price_ngn: 320000, is_premium: true },
    { creator_id: 1, name: "Aso-Oke Gele", part: "head_piece", style: "Aso-Oke", event_tags: ["wedding", "traditional"], colours: ["Coral", "Gold"], gender: "female", price_ngn: 45000, is_premium: true },
    { creator_id: 1, name: "Beaded Clutch", part: "bag", style: "Ankara", event_tags: ["wedding", "corporate"], colours: ["Gold"], gender: "female", price_ngn: 35000, is_premium: true },
    { creator_id: 1, name: "Embroidered Kaftan", part: "main_outfit", style: "Kaftan", event_tags: ["corporate", "casual"], colours: ["Emerald"], gender: "male", price_ngn: 165000, is_premium: true },
    { creator_id: 1, name: "Senator Suit", part: "main_outfit", style: "Senator", event_tags: ["corporate", "wedding"], colours: ["Navy"], gender: "male", price_ngn: 195000, is_premium: true },
    { creator_id: 1, name: "Ankara Two-Piece", part: "main_outfit", style: "Two-piece", event_tags: ["casual", "festival"], colours: ["Ankara"], gender: "female", price_ngn: 98000, is_premium: true },
    { creator_id: 1, name: "Gold Heels", part: "shoes", style: "Gown", event_tags: ["wedding", "evening"], colours: ["Gold"], gender: "female", price_ngn: 55000, is_premium: true },
    { creator_id: 2, name: "Midnight Agbada", part: "main_outfit", style: "Agbada", event_tags: ["wedding", "traditional"], colours: ["Navy", "Gold"], gender: "male", price_ngn: 310000, is_premium: true },
    { creator_id: 2, name: "Silk Senator", part: "main_outfit", style: "Senator", event_tags: ["corporate"], colours: ["Charcoal"], gender: "male", price_ngn: 175000, is_premium: true },
    { creator_id: 3, name: "Coral Bridal Lace", part: "main_outfit", style: "Lace", event_tags: ["wedding"], colours: ["Coral", "White"], gender: "female", price_ngn: 450000, is_premium: true },
    { creator_id: 3, name: "Bridal Veil Set", part: "head_piece", style: "Lace", event_tags: ["wedding"], colours: ["White"], gender: "female", price_ngn: 65000, is_premium: true },
    // Ghana bag for hostile audit Hers+Ghana+bag filter in live path
    { creator_id: 5, name: "Ghana Kente Clutch", part: "bag", style: "Ankara", event_tags: ["festival", "casual"], colours: ["Gold"], gender: "female", price_ngn: 42000, country: "Ghana", is_premium: true },
  ];

  const garments = garmentRows.map((g, i) => ({
    id: i + 1,
    ...g,
    is_active: true,
    image: null,
    card_image: null,
    created_at: new Date().toISOString(),
  }));

  return {
    users: [
      {
        id: IDS.founding,
        email: FOUNDING_EMAIL,
        password: "Founding2026!",
        email_confirmed_at: new Date().toISOString(),
        user_metadata: { full_name: "Olufemi Adeagbo" },
        app_metadata: { provider: "email" },
      },
      {
        id: IDS.tester,
        email: TESTER_EMAIL,
        password: TESTER_PASSWORD,
        email_confirmed_at: new Date().toISOString(),
        user_metadata: { full_name: "Content Tester" },
        app_metadata: { provider: "email" },
      },
      {
        id: IDS.demo,
        email: "user@myyanga.test",
        password: "User2026!",
        email_confirmed_at: new Date().toISOString(),
        user_metadata: { full_name: "Demo User" },
        app_metadata: { provider: "email" },
      },
    ],
    profiles: [
      { id: IDS.founding, email: FOUNDING_EMAIL, name: "Olufemi Adeagbo", role: "owner", is_owner: true, status: "ACTIVE" },
      { id: IDS.tester, email: TESTER_EMAIL, name: "Content Tester", role: "admin", is_owner: false, status: "ACTIVE" },
      { id: IDS.demo, email: "user@myyanga.test", name: "Demo User", role: "user", is_owner: false, status: "ACTIVE" },
    ],
    creators,
    garments,
    looks: [],
    look_comments: [],
    events: [
      { id: 1, title: "Lagos Fashion Week Preview", description: "Runway preview of top African designers.", venue: "Eko Hotel", city: "Lagos", starts_at: new Date(Date.now() + 14 * 86400000).toISOString(), is_published: true },
      { id: 2, title: "Abuja Bridal Expo", description: "Bridal fashion showcase.", venue: "Transcorp Hilton", city: "Abuja", starts_at: new Date(Date.now() + 30 * 86400000).toISOString(), is_published: true },
    ],
    pyl_entries: [],
    monetization_settings: [
      { feature: "virtual_wear", enabled: true, mode: "free", price_ngn: 0, currency: "NGN", billing: "one_time", provider_order: ["flutterwave", "paystack", "stripe"] },
      { feature: "smart_search", enabled: true, mode: "free", price_ngn: 0, currency: "NGN", billing: "one_time", provider_order: ["flutterwave", "paystack", "stripe"] },
      { feature: "pyl_entry", enabled: true, mode: "free", price_ngn: 0, currency: "NGN", billing: "one_time", provider_order: ["flutterwave", "paystack", "stripe"] },
      { feature: "premium", enabled: true, mode: "paid", price_ngn: 2500, currency: "NGN", billing: "one_time", provider_order: ["flutterwave", "paystack", "stripe"] },
      { feature: "events", enabled: true, mode: "free", price_ngn: 0, currency: "NGN", billing: "one_time", provider_order: ["flutterwave", "paystack", "stripe"] },
      { feature: "creator_promotion", enabled: true, mode: "paid", price_ngn: 50000, currency: "NGN", billing: "one_time", provider_order: ["flutterwave", "paystack", "stripe"] },
    ],
    entitlements: [],
    admin_privileges: [
      { id: 1, user_id: IDS.tester, privilege: "content_studio" },
      { id: 2, user_id: IDS.tester, privilege: "garments" },
      { id: 3, user_id: IDS.tester, privilege: "delete_selected" },
    ],
    platform_co_owners: [],
    editorial_daily: [],
    analytics_events: [],
    blog_comments: [],
    settings: [
      { name: "founding_owner_email", value: FOUNDING_EMAIL },
      { name: "google_auth_enabled", value: "true" },
    ],
    sequences: { garments: garments.length, creators: creators.length, looks: 0, events: 2, pyl_entries: 0 },
    magic_links: {},
    wa_challenges: {},
  };
}

let store = null;

export function loadDb() {
  if (store) return store;
  mkdirSync(root, { recursive: true });
  if (existsSync(storePath)) {
    try {
      store = JSON.parse(readFileSync(storePath, "utf8"));
      return store;
    } catch {
      store = defaultStore();
    }
  } else {
    store = defaultStore();
  }
  saveDb();
  return store;
}

export function saveDb() {
  if (!store) return;
  mkdirSync(root, { recursive: true });
  writeFileSync(storePath, JSON.stringify(store, null, 2));
}

export function resetDb() {
  store = defaultStore();
  saveDb();
  return store;
}

export function getUserByEmail(email) {
  const db = loadDb();
  return db.users.find((u) => u.email?.toLowerCase() === String(email || "").toLowerCase());
}

export function getUserById(id) {
  const db = loadDb();
  return db.users.find((u) => u.id === id);
}

export function ensureUser({ email, password, metadata = {} }) {
  const db = loadDb();
  let user = getUserByEmail(email);
  if (!user) {
    user = {
      id: randomUUID(),
      email,
      password: password || randomUUID(),
      email_confirmed_at: new Date().toISOString(),
      user_metadata: metadata,
      app_metadata: { provider: "email" },
    };
    db.users.push(user);
    db.profiles.push({
      id: user.id,
      email,
      name: metadata.full_name || email.split("@")[0],
      role: "user",
      is_owner: false,
      status: "ACTIVE",
    });
    saveDb();
  }
  return user;
}

export function getProfile(userId) {
  const db = loadDb();
  return db.profiles.find((p) => p.id === userId);
}

export function getFeatureGate(feature, userId) {
  const db = loadDb();
  if (UNLOCK_ALL_GATES) {
    return { feature, enabled: true, mode: "free", access: true, tester: true };
  }
  const s = db.monetization_settings.find((m) => m.feature === feature);
  if (!s || !s.enabled) {
    return { feature, enabled: false, access: false };
  }
  if (s.mode === "free") {
    return { feature, enabled: true, mode: "free", access: true };
  }
  const entitled = db.entitlements.some(
    (e) => e.user_id === userId && e.feature === feature && (!e.expires_at || new Date(e.expires_at) > new Date()),
  );
  return {
    feature,
    enabled: true,
    mode: "paid",
    price_ngn: s.price_ngn,
    currency: s.currency,
    billing: s.billing,
    provider_order: s.provider_order,
    access: entitled,
  };
}

export function table(name) {
  const db = loadDb();
  if (!db[name]) db[name] = [];
  return db[name];
}

export function nextId(tableName) {
  const db = loadDb();
  db.sequences[tableName] = (db.sequences[tableName] || 0) + 1;
  return db.sequences[tableName];
}

export { IDS, TESTER_EMAIL, TESTER_PASSWORD };
