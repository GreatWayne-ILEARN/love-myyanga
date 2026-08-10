// Virtual try-on — photorealistic AI compositing.
// Provider cascade: Replicate IDM-VTON → Gemini image edit.
// Client falls back to on-device canvas when unavailable (no keys / error).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function parseDataUrl(dataUrl: string): { mime: string; data: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  return m ? { mime: m[1], data: m[2] } : null;
}

async function fetchAsBase64(url: string): Promise<{ mime: string; data: string } | null> {
  const inline = parseDataUrl(url);
  if (inline) return inline;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const mime = r.headers.get("content-type") || "image/jpeg";
    const buf = new Uint8Array(await r.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) {
      bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    }
    return { mime, data: btoa(bin) };
  } catch {
    return null;
  }
}

function toDataUrl(img: { mime: string; data: string }) {
  return `data:${img.mime};base64,${img.data}`;
}

const SCENE_PROMPTS: Record<string, string> = {
  plain: "Keep the original background unchanged.",
  wedding: "Place the person in an elegant African wedding hall with warm gold-and-cream decor.",
  corporate: "Place the person in a modern corporate office lobby with clean neutral tones.",
  festival: "Place the person at a vibrant Nigerian owambe celebration with rich maroon and gold decor.",
  traditional: "Place the person in a dignified traditional African courtyard setting.",
  date: "Place the person in an upscale evening restaurant setting with soft warm lighting.",
  casual: "Place the person in a bright contemporary urban street setting.",
};

/** Replicate IDM-VTON — production virtual try-on when REPLICATE_API_TOKEN is set. */
async function replicateTryOn(
  person: { mime: string; data: string },
  garment: { mime: string; data: string },
  garmentName: string,
): Promise<string | null> {
  const token = Deno.env.get("REPLICATE_API_TOKEN");
  const version = Deno.env.get("REPLICATE_VTON_VERSION") ||
    "906425dbca90663ff5427624839572cc8772b02c990aeeeac3a013bfcf02fe58";
  if (!token) return null;

  const personUrl = toDataUrl(person);
  const garmentUrl = toDataUrl(garment);

  const create = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify({
      version,
      input: {
        human_img: personUrl,
        garm_img: garmentUrl,
        garment_des: garmentName || "African fashion outfit",
        is_checked: true,
        is_checked_crop: false,
        denoise_steps: 30,
      },
    }),
  });

  if (!create.ok) {
    console.error("Replicate create failed", await create.text());
    return null;
  }

  let pred = await create.json();
  const deadline = Date.now() + 90_000;
  while (pred.status === "starting" || pred.status === "processing") {
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!poll.ok) return null;
    pred = await poll.json();
  }

  if (pred.status !== "succeeded" || !pred.output) return null;
  const outUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (typeof outUrl !== "string") return null;

  const img = await fetchAsBase64(outUrl);
  return img ? toDataUrl(img) : null;
}

async function geminiTryOn(
  person: { mime: string; data: string },
  garmentParts: unknown[],
  named: string[],
  scene: string,
): Promise<string | null> {
  const key = Deno.env.get("GOOGLE_API_KEY");
  if (!key) return null;

  const parts: unknown[] = [{ inline_data: { mime_type: person.mime, data: person.data } }, ...garmentParts];
  const prompt =
    `The first image is a person. The following images are African fashion garments` +
    (named.length ? ` (${named.join(", ")})` : "") +
    `. Generate a photorealistic image of this exact person wearing these garments as a complete styled outfit. ` +
    `Preserve the person's face, skin tone, body shape and pose faithfully. ` +
    `Fit the garments naturally with realistic draping, fabric texture and lighting. ` +
    (SCENE_PROMPTS[scene] || SCENE_PROMPTS.plain) +
    ` High-end fashion editorial quality.`;
  parts.push({ text: prompt });

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    },
  );

  if (!r.ok) {
    console.error("Gemini failed", await r.text());
    return null;
  }

  const d = await r.json();
  const out = d?.candidates?.[0]?.content?.parts?.find(
    (p: { inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }) =>
      p.inlineData?.data || p.inline_data?.data,
  );
  const b64 = out?.inlineData?.data || out?.inline_data?.data;
  if (!b64) return null;
  const mime = out?.inlineData?.mimeType || out?.inline_data?.mime_type || "image/png";
  return `data:${mime};base64,${b64}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: gate } = await admin.rpc("get_feature_gate", { p_feature: "virtual_wear" });
  if (!gate?.access) return json({ error: "Payment required", gate }, 402);

  const hasReplicate = !!Deno.env.get("REPLICATE_API_TOKEN");
  const hasGemini = !!Deno.env.get("GOOGLE_API_KEY");
  if (!hasReplicate && !hasGemini) {
    return json({
      error: "AI try-on not configured — set REPLICATE_API_TOKEN or GOOGLE_API_KEY on virtual-tryon",
      fallback: true,
      providers_missing: ["replicate", "gemini"],
    }, 501);
  }

  const body = await req.json().catch(() => ({}));
  const {
    personImage,
    selfiePath,
    selfieUrl,
    garments = [],
    scene = "plain",
  } = body as {
    personImage?: string;
    selfiePath?: string;
    selfieUrl?: string;
    garments?: { name?: string; image?: string; part?: string; style?: string }[];
    scene?: string;
  };

  let person = personImage ? parseDataUrl(personImage) : null;
  if (!person && selfieUrl) {
    person = await fetchAsBase64(selfieUrl);
  }
  if (!person && selfiePath) {
    const base = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (base && serviceKey) {
      const signed = await fetch(`${base}/storage/v1/object/sign/looks/${selfiePath}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: 3600 }),
      });
      const sd = await signed.json().catch(() => ({}));
      const url = sd?.signedURL ? `${base}/storage/v1${sd.signedURL}` : null;
      if (url) person = await fetchAsBase64(url);
    }
  }
  if (!person) return json({ error: "personImage, selfieUrl, or selfiePath required" }, 400);
  if (person.data.length > 8_000_000) return json({ error: "Photo too large — max ~6MB" }, 413);

  const garmentParts: unknown[] = [];
  const named: string[] = [];
  let primaryGarment: { mime: string; data: string } | null = null;
  let primaryName = "African fashion outfit";

  for (const g of (garments as { name?: string; image?: string; part?: string }[]).slice(0, 4)) {
    if (g.name) named.push(g.name);
    if (!g.image) continue;
    const img = await fetchAsBase64(g.image);
    if (!img) continue;
    garmentParts.push({ inline_data: { mime_type: img.mime, data: img.data } });
    if (g.part === "main_outfit" || !primaryGarment) {
      primaryGarment = img;
      primaryName = g.name || primaryName;
    }
  }

  if (!primaryGarment && garmentParts.length) {
    const first = await fetchAsBase64((garments.find((g) => g.image) || {}).image || "");
    if (first) {
      primaryGarment = first;
      primaryName = garments[0]?.name || primaryName;
    }
  }

  let image: string | null = null;
  let provider: string | null = null;

  if (hasReplicate && primaryGarment) {
    image = await replicateTryOn(person, primaryGarment, primaryName);
    if (image) provider = "replicate-idm-vton";
  }

  if (!image && hasGemini) {
    image = await geminiTryOn(person, garmentParts, named, scene);
    if (image) provider = "gemini-2.5-flash-image";
  }

  if (!image) {
    return json({
      error: "AI try-on failed — no image returned from configured providers",
      fallback: true,
      providers_tried: [hasReplicate ? "replicate" : null, hasGemini ? "gemini" : null].filter(Boolean),
    }, 502);
  }

  return json({ image, provider, scene });
});
