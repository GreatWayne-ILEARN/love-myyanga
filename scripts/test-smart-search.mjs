#!/usr/bin/env node
/**
 * Smart Search filter matching — node unit tests for catalog.matchGarment.
 * Run: npm run test:smart-search
 */
import { matchGarment, emptyMultiFilters } from "../src/lib/catalog.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const baseGarment = {
  id: 1,
  name: "Coral Royal Agbada",
  part: "main_outfit",
  style: "Agbada",
  categories: ["Agbada", "Afrocentric", "Groom"],
  event_tags: ["wedding", "festival", "traditional"],
  colours: ["Coral", "Gold"],
  gender: "male",
  country: "Nigeria",
  price_ngn: 285000,
  is_premium: true,
  creator: { name: "Mai Atafo", country: "Nigeria", is_promoted: true },
};

function run() {
  console.log("=== Smart Search Filter Tests ===\n");

  const f = emptyMultiFilters();
  f.gender = "male";
  assert(matchGarment(baseGarment, f), "male gender should match male garment");
  f.gender = "female";
  assert(!matchGarment(baseGarment, f), "female gender should not match male garment");

  const unisex = { ...baseGarment, gender: "unisex" };
  f.gender = "female";
  assert(matchGarment(unisex, f), "unisex should match female filter");

  f.gender = "male";
  f.events = ["wedding"];
  assert(matchGarment(baseGarment, f), "single event overlap");
  f.events = ["corporate"];
  assert(!matchGarment(baseGarment, f), "non-matching event");

  f.events = ["wedding", "corporate"];
  assert(matchGarment(baseGarment, f), "multi-event OR within group");

  f.events = [];
  f.styles = ["Agbada"];
  assert(matchGarment(baseGarment, f), "style filter match");
  f.styles = ["Kaftan"];
  assert(!matchGarment(baseGarment, f), "style filter miss");

  f.styles = ["Agbada", "Kaftan"];
  assert(matchGarment(baseGarment, f), "multi-style OR");

  f.styles = [];
  f.colours = ["Coral"];
  assert(matchGarment(baseGarment, f), "colour overlap");
  f.colours = ["Navy"];
  assert(!matchGarment(baseGarment, f), "colour miss");

  f.colours = [];
  f.categories = ["Groom"];
  assert(matchGarment(baseGarment, f), "category from categories array");
  f.categories = ["Corporate"];
  assert(!matchGarment(baseGarment, f), "category miss");

  f.categories = [];
  f.countries = ["Nigeria"];
  assert(matchGarment(baseGarment, f), "country match");
  f.countries = ["Ghana"];
  assert(!matchGarment(baseGarment, f), "country miss");

  f.countries = [];
  f.parts = ["main_outfit"];
  assert(matchGarment(baseGarment, f), "part match");
  f.parts = ["shoes"];
  assert(!matchGarment(baseGarment, f), "part miss");

  f.parts = [];
  f.priceBands = ["100000-300000"];
  assert(matchGarment(baseGarment, f), "price band match");
  f.priceBands = ["0-100000"];
  assert(!matchGarment(baseGarment, f), "price band miss");

  f.priceBands = [];
  f.budgetMin = "200000";
  f.budgetMax = "300000";
  assert(matchGarment(baseGarment, f), "budget range match");
  f.budgetMax = "250000";
  assert(!matchGarment(baseGarment, f), "budget max miss");

  f.budgetMin = "";
  f.budgetMax = "";
  f.promotedOnly = true;
  assert(matchGarment(baseGarment, f), "promoted pool match");
  const notPromoted = { ...baseGarment, is_premium: false, creator: { ...baseGarment.creator, is_promoted: false } };
  assert(!matchGarment(notPromoted, f), "promoted pool miss");

  f.promotedOnly = false;
  f.query = "coral royal";
  assert(matchGarment(baseGarment, f), "text query match");
  f.query = "senator";
  assert(!matchGarment(baseGarment, f), "text query miss");

  f.query = "";
  f.gender = "male";
  f.events = ["wedding"];
  f.styles = ["Agbada"];
  f.colours = ["Coral"];
  assert(matchGarment(baseGarment, f), "combined multi-param AND");

  console.log("PASS all matchGarment filter cases");
  console.log("\nALL PASS");
}

try {
  run();
} catch (e) {
  console.error("\nFAIL:", e.message);
  process.exit(1);
}
