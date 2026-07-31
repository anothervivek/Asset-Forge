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

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function isValidCode(code: string): boolean {
  if (code.length !== 4) return false;
  for (const ch of code) if (!ALPHABET.includes(ch)) return false;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

  // Accepts either {relay}/grab/CODE (path segment) or {relay}/grab?code=CODE
  // (query param) — the dashboard's function URL routing can vary, so both work.
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("code");
  const segments = url.pathname.split("/").filter(Boolean);
  const lastSegment = segments.at(-1);
  // Guard against the no-code case where the last path segment is just the
  // function's own route name (".../functions/v1/grab" with nothing after it).
  const fromPath = lastSegment && lastSegment.toLowerCase() !== "grab" ? lastSegment : undefined;
  const code = (fromQuery ?? fromPath ?? "").toUpperCase();

  if (!isValidCode(code)) {
    return json({ error: "invalid code" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase
    .from("grabs")
    .select("image")
    .eq("code", code)
    .maybeSingle();

  if (error || !data) {
    return json({ error: "not found" }, 404);
  }

  return json({ image: data.image });
});
