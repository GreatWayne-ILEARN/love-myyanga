/** Supabase Tester — local mock config (mirrors Supabase local dev keys). */
export const PORT = Number(process.env.SUPABASE_TESTER_PORT || 54322);
export const HOST = process.env.SUPABASE_TESTER_HOST || "127.0.0.1";
export const BASE_URL = `http://${HOST}:${PORT}`;

// Standard Supabase CLI local keys (HS256, role in payload)
export const JWT_SECRET =
  process.env.SUPABASE_TESTER_JWT_SECRET ||
  "super-secret-jwt-token-with-at-least-32-characters-long";

export const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

/** Feature gates: all access=true in tester unless SUPABASE_TESTER_STRICT_GATES=1 */
export const UNLOCK_ALL_GATES = process.env.SUPABASE_TESTER_STRICT_GATES !== "1";

/** WhatsApp OTP exposed in API (staging behaviour) */
export const WA_EXPOSE_OTP = process.env.WA_AUTH_EXPOSE_OTP !== "0";

export const FOUNDING_EMAIL = "oadeagbo@gmail.com";
export const TESTER_EMAIL = "tester@myyanga.test";
export const TESTER_PASSWORD = "Test2026!";
