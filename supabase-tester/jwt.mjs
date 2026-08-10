import crypto from "crypto";
import { JWT_SECRET } from "./config.mjs";

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

export function signJwt(payload, expiresInSec = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    exp: now + expiresInSec,
    iss: "supabase-tester",
    aud: "authenticated",
  };
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const data = b64url(JSON.stringify(body));
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${data}`).digest("base64url");
  return `${header}.${data}.${sig}`;
}

export function verifyJwt(token) {
  if (!token) return null;
  const parts = token.replace(/^Bearer\s+/i, "").split(".");
  if (parts.length !== 3) return null;
  const [header, data, sig] = parts;
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${data}`).digest("base64url");
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function userToken(user) {
  return signJwt({
    sub: user.id,
    email: user.email,
    role: "authenticated",
    user_metadata: user.user_metadata || {},
    app_metadata: user.app_metadata || {},
  });
}
