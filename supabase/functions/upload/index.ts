// Self-contained on purpose (no relative imports) so it can be pasted straight into
// the Snap Cloud / Supabase dashboard's Edge Function editor. The _shared/ versions
// of this logic (with unit tests) live alongside for local dev via the Supabase CLI —
// keep both in sync if you change one.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Excludes I/O/0/1 so codes read unambiguously off a HUD.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < 4; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

const MAX_IMAGE_BASE64_LENGTH = 12 * 1024 * 1024; // ~12MB body cap per spec
const MIN_IMAGE_BASE64_LENGTH = 100; // guards against empty/near-empty payloads
const MAX_PROMPT_LENGTH = 2000;

// `source`/`prompt` are optional and default to a pinch-captured photo's shape (source
// "capture", no prompt) — TextureGrab.ts's existing upload calls never send either field
// and keep working unchanged. GeminiTextureGenerate.ts sends source "ai" (and the prompt
// that produced the image) so the web companion can skip PBR-map derivation for it and
// show it as a flat, ready-to-download image instead — see migration 0004_grab_source.sql.
function validateImagePayload(
  body: unknown,
):
  | { ok: true; image: string; source: "capture" | "ai"; prompt: string | null }
  | { ok: false; status: number; error: string } {
  if (typeof body !== "object" || body === null || !("image" in body)) {
    return { ok: false, status: 400, error: "missing image" };
  }
  const record = body as Record<string, unknown>;

  const image = record.image;
  if (typeof image !== "string" || image.length < MIN_IMAGE_BASE64_LENGTH) {
    return { ok: false, status: 400, error: "image missing or too short" };
  }
  if (image.length > MAX_IMAGE_BASE64_LENGTH) {
    return { ok: false, status: 413, error: "image too large" };
  }

  const rawSource = record.source;
  if (rawSource !== undefined && rawSource !== "capture" && rawSource !== "ai") {
    return { ok: false, status: 400, error: "invalid source" };
  }
  const source: "capture" | "ai" = rawSource === "ai" ? "ai" : "capture";

  const rawPrompt = record.prompt;
  if (rawPrompt !== undefined && typeof rawPrompt !== "string") {
    return { ok: false, status: 400, error: "invalid prompt" };
  }
  if (typeof rawPrompt === "string" && rawPrompt.length > MAX_PROMPT_LENGTH) {
    return { ok: false, status: 400, error: "prompt too long" };
  }
  const prompt = typeof rawPrompt === "string" && rawPrompt.length > 0 ? rawPrompt : null;

  return { ok: true, image, source, prompt };
}

const MAX_CODE_ATTEMPTS = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const validated = validateImagePayload(body);
  if (!validated.ok) return json({ error: validated.error }, validated.status);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Library mode: grabs persist until manually deleted, so there's no TTL/GC here anymore.
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCode();
    const { error } = await supabase
      .from("grabs")
      .insert({ code, image: validated.image, source: validated.source, prompt: validated.prompt });

    if (!error) return json({ code });
    if (error.code !== "23505") { // not a unique-violation on `code` -> a real failure, stop retrying
      return json({ error: "storage failed" }, 500);
    }
  }

  return json({ error: "could not allocate a code, try again" }, 500);
});
