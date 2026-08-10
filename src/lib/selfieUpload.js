/**
 * Selfie upload for Virtual Wear (Lovable-style: storage path → edge function).
 * Testing mode uses inline data URLs only.
 */
import { supabase, hasSupabase } from "./supabase.js";
import { isProduction } from "./dataBridge.js";

const BUCKET = "looks";

function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] || "image/jpeg";
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

/**
 * Upload selfie to Supabase storage. Returns path + signed URL for edge functions.
 * @param {string} userId
 * @param {string|File|Blob} source data URL, File, or Blob
 */
export async function uploadSelfie(userId, source) {
  if (!hasSupabase || !userId) throw new Error("Sign in required to upload selfie");
  const blob =
    typeof source === "string" && source.startsWith("data:")
      ? dataUrlToBlob(source)
      : source instanceof Blob
        ? source
        : null;
  if (!blob) throw new Error("Invalid selfie source");

  const ext = blob.type.includes("png") ? "png" : "jpg";
  const path = `${userId}/selfies/${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    upsert: false,
  });
  if (upErr) throw new Error(upErr.message || "Selfie upload failed");

  const { data: signed, error: signErr } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (signErr || !signed?.signedUrl) throw new Error(signErr?.message || "Could not sign selfie URL");

  return { path, signedUrl: signed.signedUrl };
}

/**
 * Basic selfie moderation (Lovable pattern). Production can swap in Vision API later.
 * Rejects tiny images, non-portrait aspect ratios, and oversized files.
 */
export async function moderateSelfie(source) {
  const blob =
    typeof source === "string" && source.startsWith("data:")
      ? dataUrlToBlob(source)
      : source instanceof Blob
        ? source
        : null;
  if (!blob) return { ok: false, reason: "Invalid image file" };
  if (blob.size > 6_000_000) return { ok: false, reason: "Photo too large — use an image under 6MB" };
  if (blob.size < 8_000) return { ok: false, reason: "Photo too small — upload a clearer selfie" };

  if (typeof document === "undefined") return { ok: true };

  const url = URL.createObjectURL(blob);
  try {
    const dims = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => reject(new Error("Could not read image"));
      img.src = url;
    });
    if (dims.w < 240 || dims.h < 320) {
      return { ok: false, reason: "Selfie resolution too low — try a closer, well-lit photo" };
    }
    const ratio = dims.w / dims.h;
    if (ratio < 0.45 || ratio > 1.2) {
      return { ok: false, reason: "Use a portrait selfie (face and shoulders visible)" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "Could not validate selfie — try another photo" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** In production, upload selfie and return refs for try-on API. Testing returns null. */
export async function prepareSelfieForTryOn(photoDataUrl, existingPath = null) {
  if (existingPath) {
    if (!hasSupabase || !isProduction()) return { photoDataUrl, selfiePath: existingPath, selfieUrl: null };
    try {
      const { data: signed, error } = await supabase.storage.from(BUCKET).createSignedUrl(existingPath, 3600);
      if (!error && signed?.signedUrl) {
        return { photoDataUrl, selfiePath: existingPath, selfieUrl: signed.signedUrl };
      }
    } catch {
      /* fall through */
    }
    return { photoDataUrl, selfiePath: existingPath, selfieUrl: null };
  }
  if (!isProduction() || !hasSupabase) return { photoDataUrl, selfiePath: null, selfieUrl: null };
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user?.id;
  if (!uid) return { photoDataUrl, selfiePath: null, selfieUrl: null };
  try {
    const { path, signedUrl } = await uploadSelfie(uid, photoDataUrl);
    return { photoDataUrl, selfiePath: path, selfieUrl: signedUrl };
  } catch {
    return { photoDataUrl, selfiePath: null, selfieUrl: null };
  }
}
