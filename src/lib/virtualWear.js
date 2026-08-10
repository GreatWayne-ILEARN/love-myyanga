/**
 * Virtual wear rendering.
 * Provider cascade (edge function): Replicate IDM-VTON → Gemini image edit → on-device canvas.
 * Canvas fallback always resolves garment art so output differs from the input photo.
 */
import { supabase, hasSupabase } from "./supabase.js";
import { isProduction } from "./dataBridge.js";
import { enrichGarmentImages, resolveGarmentImage } from "./garmentArt.js";
import { prepareSelfieForTryOn } from "./selfieUpload.js";

const SCENES = {
  plain: null,
  wedding: { c1: "#f5ebe0", c2: "#d4a574", label: "Wedding" },
  corporate: { c1: "#e8eaed", c2: "#5f6368", label: "Corporate" },
  festival: { c1: "#850713", c2: "#B8893A", label: "Owambe / Festival" },
  traditional: { c1: "#850713", c2: "#C9A227", label: "Traditional" },
  date: { c1: "#2E5E4E", c2: "#16302a", label: "Date / Evening" },
  casual: { c1: "#4a5568", c2: "#cbd5e0", label: "Casual" },
};

export function sceneOptions() {
  return Object.entries(SCENES).map(([k, v]) => ({ id: k, label: v?.label || "Plain background" }));
}

function loadImg(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = () => rej(new Error(`Could not load garment image`));
    i.src = src;
  });
}

const FN_BASE = import.meta.env?.VITE_SUPABASE_URL?.replace(/\/$/, "");
const FN = FN_BASE ? `${FN_BASE}/functions/v1` : null;

/** Quick fingerprint — catches unchanged output without pixel-perfect compare. */
export function imageFingerprint(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return "";
  const body = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  const slice = body.slice(0, 4000) + body.slice(-2000);
  let h = 0;
  for (let i = 0; i < slice.length; i++) h = (h * 31 + slice.charCodeAt(i)) >>> 0;
  return `${body.length}:${h}`;
}

export function imagesDiffer(a, b) {
  if (!a || !b) return true;
  return imageFingerprint(a) !== imageFingerprint(b);
}

/**
 * Photorealistic AI try-on via the virtual-tryon edge function.
 * Throws with { fallback: true } when the server wants canvas compositing.
 */
export async function aiTryOn({ photoDataUrl, garments, scene = "plain", selfiePath: existingPath = null }) {
  if (!hasSupabase || !isProduction()) {
    const e = new Error("AI try-on needs Production mode with Supabase");
    e.fallback = true;
    throw e;
  }
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    const e = new Error("Sign in required for AI try-on");
    e.fallback = true;
    throw e;
  }
  const enriched = enrichGarmentImages(garments);
  const selfie = await prepareSelfieForTryOn(photoDataUrl, existingPath);
  if (!FN) {
    const e = new Error("AI try-on needs Production mode with Supabase");
    e.fallback = true;
    throw e;
  }
  const r = await fetch(`${FN}/virtual-tryon`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      personImage: selfie.photoDataUrl,
      selfiePath: selfie.selfiePath,
      selfieUrl: selfie.selfieUrl,
      garments: enriched.map((g) => ({
        name: g.name,
        image: resolveGarmentImage(g),
        part: g.part,
        style: g.style,
      })),
      scene,
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 402) {
    const e = new Error("Payment required for virtual wear");
    e.paymentRequired = true;
    throw e;
  }
  if (r.status === 501 && d.fallback) {
    const e = new Error(d.error || "AI try-on not configured — using on-device preview");
    e.fallback = true;
    throw e;
  }
  if (!r.ok || !d.image) {
    const e = new Error(d.error || "AI try-on failed");
    e.fallback = d.fallback !== false;
    throw e;
  }
  if (!imagesDiffer(photoDataUrl, d.image)) {
    const e = new Error("AI returned unchanged image — falling back to garment overlay");
    e.fallback = true;
    throw e;
  }
  return { image: d.image, provider: d.provider };
}

/**
 * Render a look: AI try-on first, canvas compositing as fallback.
 * Returns { image, mode: "ai" | "canvas" }.
 * Throws if canvas output would match the input (no garment applied).
 */
export async function renderLook({ photoDataUrl, garments, scene = "plain", selfiePath = null }) {
  const enriched = enrichGarmentImages(garments);
  let lastErr = null;
  try {
    const out = await aiTryOn({ photoDataUrl, garments: enriched, scene, selfiePath });
    return { image: out.image, mode: "ai", provider: out.provider };
  } catch (e) {
    if (e.paymentRequired) throw e;
    lastErr = e;
  }
  const image = await compositeLook({ photoDataUrl, garments: enriched, scene });
  if (!imagesDiffer(photoDataUrl, image)) {
    throw new Error(
      lastErr?.message ||
        "Virtual Wear could not apply garments — check garment images and try again",
    );
  }
  return { image, mode: "canvas" };
}

/** Composite user photo + garment overlays + optional scene tint. */
export async function compositeLook({ photoDataUrl, garments, scene = "plain" }) {
  const photo = await loadImg(photoDataUrl);
  const w = Math.min(900, photo.naturalWidth);
  const h = Math.round((photo.naturalHeight / photo.naturalWidth) * w);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");

  ctx.drawImage(photo, 0, 0, w, h);

  const sc = SCENES[scene];
  if (sc) {
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, sc.c1 + "cc");
    g.addColorStop(1, sc.c2 + "aa");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  const main = garments.find((g) => g.part === "main_outfit") || garments[0];
  const accessories = garments.filter((g) => g !== main);
  const drawOrder = [...(main ? [main] : []), ...accessories];

  for (let i = 0; i < drawOrder.length; i++) {
    const g = drawOrder[i];
    const src = resolveGarmentImage(g);
    if (!src) continue;
    try {
      const img = await loadImg(src);
      const isMain = g.part === "main_outfit" || i === 0;
      const scale = isMain ? 0.62 : 0.28 + i * 0.04;
      const gw = w * scale;
      const gh = (img.naturalHeight / img.naturalWidth) * gw;
      const gx = (w - gw) / 2;
      const gy = isMain ? h * 0.14 : g.part === "shoes" ? h * 0.72 : g.part === "bag" ? h * 0.55 : h * 0.08;
      ctx.save();
      ctx.globalAlpha = isMain ? 0.94 : 0.9;
      ctx.globalCompositeOperation = isMain ? "source-over" : "source-over";
      ctx.drawImage(img, gx, gy, gw, gh);
      if (isMain) {
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = 0.22;
        ctx.drawImage(img, gx, gy, gw, gh);
      }
      ctx.restore();
    } catch {
      ctx.save();
      ctx.fillStyle = "rgba(133,7,19,0.35)";
      ctx.fillRect(w * 0.15, h * 0.2, w * 0.7, h * 0.5);
      ctx.fillStyle = "#f0d9b8";
      ctx.font = "bold 16px Raleway,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(g.name || "Garment", w / 2, h * 0.46);
      ctx.restore();
    }
  }

  return c.toDataURL("image/jpeg", 0.9);
}

/** Build a look from selected garment rows */
export function buildLookDeck(garments, brief = {}) {
  const parts = ["head_piece", "main_outfit", "shoes", "jewellery", "bag"];
  const byPart = {};
  for (const p of parts) {
    const match = garments.find((g) => g.part === p) || garments.find((g) => g.part === "main_outfit");
    if (match && !byPart[p]) byPart[p] = match;
  }
  const items = Object.values(byPart);
  const total = items.reduce((s, g) => s + (g.price_ngn || 0), 0);
  const brand = items[0]?.creator?.name || items[0]?.creator || "MyYanga";
  return {
    name: `${brief.style || "Statement"} Look`,
    style: brief.style || "",
    scene: brief.scene || "plain",
    items,
    total_ngn: total,
    designer: brand,
  };
}

export async function shareLookNative(dataUrl, title = "My MyYanga look") {
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], "myyanga-look.jpg", { type: "image/jpeg" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title, text: "What do you think of this look?", files: [file] });
    return true;
  }
  return false;
}
