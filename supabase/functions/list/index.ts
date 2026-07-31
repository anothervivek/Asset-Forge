// Self-contained on purpose (no relative imports) so it can be pasted straight into
// the Snap Cloud / Supabase dashboard's Edge Function editor. The _shared/ versions
// of this logic (with unit tests) live alongside for local dev via the Supabase CLI —
// keep both in sync if you change one.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const DEFAULT_LIST_LIMIT = 60;
const MAX_LIST_LIMIT = 200;
function clampLimit(raw: string | null): number {
  const n = raw === null ? NaN : parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(n, MAX_LIST_LIMIT);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

  const url = new URL(req.url);
  const limit = clampLimit(url.searchParams.get("limit"));

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // No image payload here on purpose — this powers the gallery list, thumbnails are
  // fetched lazily per-item via the existing /grab/CODE endpoint. `source`/`prompt` (see
  // migration 0004_grab_source.sql) let the web companion tell an AI Gen image apart from
  // a pinch-captured one and skip PBR-map derivation for it.
  const { data, error } = await supabase
    .from("grabs")
    .select("code, created_at, source, prompt")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return json({ error: "list failed" }, 500);

  return json({ items: data });
});
