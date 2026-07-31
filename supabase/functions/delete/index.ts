// Self-contained on purpose (no relative imports) so it can be pasted straight into
// the Snap Cloud / Supabase dashboard's Edge Function editor — matches the convention
// used by upload/grab/list/upload-model/list-models.
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

type DeleteItem = { code: string; kind: "texture" | "model" };

const MAX_ITEMS = 200;
function validateItems(
  body: unknown,
): { ok: true; items: DeleteItem[] } | { ok: false; status: number; error: string } {
  if (typeof body !== "object" || body === null || !Array.isArray((body as Record<string, unknown>).items)) {
    return { ok: false, status: 400, error: "missing items array" };
  }
  const raw = (body as Record<string, unknown>).items as unknown[];
  if (raw.length === 0) return { ok: false, status: 400, error: "items array is empty" };
  if (raw.length > MAX_ITEMS) return { ok: false, status: 400, error: "too many items" };

  const items: DeleteItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, status: 400, error: "invalid item" };
    }
    const { code, kind } = entry as Record<string, unknown>;
    if (typeof code !== "string" || code.length === 0) {
      return { ok: false, status: 400, error: "invalid code" };
    }
    if (kind !== "texture" && kind !== "model") {
      return { ok: false, status: 400, error: "invalid kind" };
    }
    items.push({ code, kind });
  }
  return { ok: true, items };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const validated = validateItems(body);
  if (!validated.ok) return json({ error: validated.error }, validated.status);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let deleted = 0;
  const failed: DeleteItem[] = [];

  for (const item of validated.items) {
    if (item.kind === "texture") {
      const { error } = await supabase.from("grabs").delete().eq("code", item.code);
      if (error) failed.push(item); else deleted++;
      continue;
    }

    // model: look up its storage_path first so the Storage object doesn't get orphaned.
    const { data: row, error: selectError } = await supabase
      .from("models")
      .select("storage_path")
      .eq("code", item.code)
      .maybeSingle();

    if (selectError) {
      failed.push(item);
      continue;
    }
    if (row) {
      await supabase.storage.from("models").remove([row.storage_path]);
    }
    const { error: deleteError } = await supabase.from("models").delete().eq("code", item.code);
    if (deleteError) failed.push(item); else deleted++;
  }

  return json({ deleted, failed });
});
