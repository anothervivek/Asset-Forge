// Self-contained on purpose (no relative imports) so it can be pasted straight into
// the Snap Cloud / Supabase dashboard's Edge Function editor — matches the convention
// used by upload/grab/list/upload-model/list-models/delete.
//
// Called by the Lens with its own persistent deviceId (see DeviceId.ts). Idempotent:
// a device that already has a code gets the same one back every time; a device that
// doesn't gets a fresh one, generated once and stored forever (migration
// 0007_device_codes.sql). No login, no email — the code itself is what the companion
// site's code-entry screen looks up to scope /list and /list-models to this device.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

// Excludes I/O/0/1 so codes read unambiguously off a HUD — same alphabet as upload/grab.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const CODE_LENGTH = 6
function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  let code = ""
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[bytes[i] % ALPHABET.length]
  return code
}

const MAX_DEVICE_ID_LENGTH = 128
const MAX_CODE_ATTEMPTS = 5

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: "invalid json" }, 400)
  }

  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>
  const deviceId = typeof record.deviceId === "string" ? record.deviceId : ""
  if (!deviceId || deviceId.length > MAX_DEVICE_ID_LENGTH) {
    return json({ error: "invalid deviceId" }, 400)
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  const { data: existing, error: lookupError } = await supabase
    .from("device_codes")
    .select("code")
    .eq("device_id", deviceId)
    .maybeSingle()

  if (lookupError) return json({ error: "lookup failed" }, 500)
  if (existing) return json({ code: existing.code })

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCode()
    const { error } = await supabase.from("device_codes").insert({ device_id: deviceId, code })

    if (!error) return json({ code })
    if (error.code !== "23505") {
      // not a unique-violation on `code` -> a real failure, stop retrying
      return json({ error: "storage failed" }, 500)
    }
  }

  return json({ error: "could not allocate a code, try again" }, 500)
})
