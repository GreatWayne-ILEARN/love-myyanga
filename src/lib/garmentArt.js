/**
 * Procedural garment artwork for Virtual Wear compositing.
 * Used when DB garments lack image/card_image URLs (production seed gap).
 */

const COLOUR_MAP = {
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

function colourHex(name) {
  if (!name) return "#850713";
  const key = String(name).toLowerCase().replace(/\s+/g, "-");
  return COLOUR_MAP[key] || COLOUR_MAP[name.toLowerCase()] || "#850713";
}

function svgData(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function shapeFor(garment) {
  const part = garment?.part || "main_outfit";
  const style = String(garment?.style || "").toLowerCase();
  if (part === "shoes") return "shoes";
  if (part === "bag") return "bag";
  if (part === "head_piece") return "gele";
  if (part === "jewellery") return "jewellery";
  if (style.includes("agbada") || style.includes("senator") || style.includes("kaftan")) return "agbada";
  if (style.includes("fabric") || style.includes("aso-oke")) return "fabric";
  return "dress";
}

function bodySvg(shape, c1, c2) {
  switch (shape) {
    case "agbada":
      return `<path d="M40 30 L80 30 L110 70 L100 200 L20 200 L10 70 Z" fill="${c1}"/><path d="M40 30 L80 30 L70 55 L50 55 Z" fill="${c2}"/><rect x="48" y="55" width="24" height="90" fill="${c2}" opacity=".35"/>`;
    case "shoes":
      return `<ellipse cx="35" cy="90" rx="28" ry="12" fill="${c1}"/><ellipse cx="85" cy="90" rx="28" ry="12" fill="${c1}"/><path d="M15 90 Q35 60 55 90" fill="${c2}"/><path d="M65 90 Q85 60 105 90" fill="${c2}"/>`;
    case "gele":
      return `<ellipse cx="60" cy="55" rx="48" ry="28" fill="${c1}"/><path d="M20 55 Q60 10 100 55" fill="${c2}"/><circle cx="60" cy="48" r="8" fill="#C9A227"/>`;
    case "bag":
      return `<rect x="30" y="45" width="60" height="70" fill="${c1}"/><path d="M45 45 V30 Q60 15 75 30 V45" stroke="${c2}" stroke-width="6" fill="none"/><circle cx="60" cy="80" r="6" fill="${c2}"/>`;
    case "jewellery":
      return `<circle cx="60" cy="70" r="28" fill="none" stroke="${c1}" stroke-width="8"/><circle cx="60" cy="70" r="18" fill="none" stroke="${c2}" stroke-width="4"/><circle cx="60" cy="42" r="6" fill="#C9A227"/>`;
    case "fabric":
      return `<rect x="12" y="20" width="96" height="160" fill="${c1}"/><path d="M12 40 H108 M12 70 H108 M12 100 H108 M12 130 H108" stroke="${c2}" stroke-width="3" opacity=".55"/>`;
    default:
      return `<path d="M45 25 L75 25 L95 55 L85 200 L35 200 L25 55 Z" fill="${c1}"/><path d="M45 25 L75 25 L70 50 L50 50 Z" fill="${c2}"/><path d="M40 90 Q60 110 80 90" stroke="${c2}" stroke-width="3" fill="none"/>`;
  }
}

/** Build a garment overlay image URL from metadata when no asset exists. */
export function garmentArtUrl(garment) {
  const colours = garment?.colours || garment?.colours_available || [];
  const c1 = colourHex(colours[0]);
  const c2 = colourHex(colours[1] || colours[0]);
  const shape = shapeFor(garment);
  const label = (garment?.name || garment?.style || "Garment").slice(0, 28);
  const tint = "#1a0a08";
  const body = bodySvg(shape, c1, c2);
  return svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320" viewBox="0 0 120 220">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <rect width="120" height="220" fill="${tint}"/>
    <rect width="120" height="220" fill="url(#g)" opacity=".22"/>
    ${body}
    <rect width="120" height="220" fill="${tint}" opacity=".18"/>
    <text x="60" y="210" text-anchor="middle" font-family="Georgia,serif" font-size="9" fill="#f0d9b8">${label}</text>
  </svg>`);
}

/** Resolve the best available image URL for compositing / AI try-on. */
export function resolveGarmentImage(garment) {
  if (!garment) return null;
  return garment.image || garment.card_image || garment.image_url || garmentArtUrl(garment);
}

/** Enrich garment rows missing overlay assets (production DB seed). */
export function enrichGarmentImages(garments = []) {
  return garments.map((g) => {
    if (!g?.image && !g?.card_image && !g?.image_url) {
      const art = garmentArtUrl(g);
      return { ...g, image: art, _art_generated: true };
    }
    return g;
  });
}
