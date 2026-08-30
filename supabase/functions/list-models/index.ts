// Self-contained on purpose (no relative imports) so it can be pasted straight into
// the Snap Cloud / Supabase dashboard's Edge Function editor — matches the convention
// used by upload/grab/list.
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

  const reqUrl = new URL(req.url);
  const limit = clampLimit(reqUrl.searchParams.get("limit"));

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Optional: see list/index.ts for why an absent ?code= keeps today's unscoped behavior.
  const rawCode = reqUrl.searchParams.get("code");
  let deviceId: string | null = null;
  if (rawCode) {
    const { data: deviceRow } = await supabase
      .from("device_codes")
      .select("device_id")
      .eq("code", rawCode.toUpperCase())
      .maybeSingle();
    if (!deviceRow) return json({ error: "invalid code" }, 404);
    deviceId = deviceRow.device_id;
  }

  let query = supabase
    .from("models")
    .select("code, prompt, storage_path, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (deviceId) query = query.eq("device_id", deviceId);

  const { data, error } = await query;

  if (error) return json({ error: "list failed" }, 500);

  // Built from the host this request actually arrived on (rather than SUPABASE_URL,
  // which points at a *.supabase.co hostname that doesn't resolve for Snap Cloud
  // projects — see the relay's Snap Cloud gotcha notes) so the public Storage URL is
  // guaranteed reachable by whatever client just successfully called this function.
  const storageBase = `${reqUrl.protocol}//${reqUrl.host}/storage/v1/object/public/models`;
  const items = (data ?? []).map((row) => ({
    code: row.code,
    prompt: row.prompt,
    created_at: row.created_at,
    url: `${storageBase}/${row.storage_path}`,
  }));

  return json({ items });
});
