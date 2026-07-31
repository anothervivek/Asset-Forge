// Self-contained on purpose (no relative imports) so it can be pasted straight into
// the Snap Cloud / Supabase dashboard's Edge Function editor — matches the convention
// used by upload/grab/list.
//
// The Lens script never uploads model bytes itself. Snap3D's getStatus() response hands
// back a plain `url` (Snap3DTypes.GltfAssetData.url) pointing at the generated .glb —
// this function fetches that URL server-side and re-hosts the bytes in the `models`
// Storage bucket, so the model survives after Snap's own (likely short-lived/signed)
// URL expires.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

const MAX_PROMPT_LENGTH = 500;
function validateSubmission(
  body: unknown,
): { ok: true; url: string; prompt: string } | { ok: false; status: number; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, status: 400, error: "missing body" };
  }
  const { url, prompt } = body as Record<string, unknown>;
  if (typeof url !== "string" || !/^https:\/\//.test(url)) {
    return { ok: false, status: 400, error: "missing or invalid url" };
  }
  if (typeof prompt !== "string" || prompt.length === 0 || prompt.length > MAX_PROMPT_LENGTH) {
    return { ok: false, status: 400, error: "missing or invalid prompt" };
  }
  return { ok: true, url, prompt };
}

const MAX_MODEL_BYTES = 60 * 1024 * 1024; // 60MB cap on the fetched .glb
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

  const validated = validateSubmission(body);
  if (!validated.ok) return json({ error: validated.error }, validated.status);

  let modelBytes: Uint8Array;
  try {
    const sourceRes = await fetch(validated.url);
    if (!sourceRes.ok) return json({ error: "could not fetch model url" }, 502);
    modelBytes = new Uint8Array(await sourceRes.arrayBuffer());
  } catch {
    return json({ error: "could not fetch model url" }, 502);
  }
  if (modelBytes.byteLength === 0) return json({ error: "empty model" }, 400);
  if (modelBytes.byteLength > MAX_MODEL_BYTES) return json({ error: "model too large" }, 413);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCode();
    const path = `${code}.glb`;

    const { error: uploadError } = await supabase.storage
      .from("models")
      .upload(path, modelBytes, { contentType: "model/gltf-binary", upsert: false });
    if (uploadError) continue; // path collision or transient — try a new code

    const { error: insertError } = await supabase
      .from("models")
      .insert({ code, prompt: validated.prompt, storage_path: path });

    if (!insertError) return json({ code });

    // Insert failed (almost certainly the code's unique-violation) — clean up the
    // orphaned storage object before retrying with a fresh code.
    await supabase.storage.from("models").remove([path]);
    if (insertError.code !== "23505") {
      return json({ error: "storage failed" }, 500);
    }
  }

  return json({ error: "could not allocate a code, try again" }, 500);
});
