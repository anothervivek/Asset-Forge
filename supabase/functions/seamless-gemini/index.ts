// Self-contained on purpose (no relative imports) so it can be pasted straight into
// the Snap Cloud / Supabase dashboard's Edge Function editor — matches the convention
// used by upload/grab/list/upload-model/list-models/delete.
//
// Uses Google's Gemini Interactions API (v1beta/interactions), NOT the Snap-hosted
// RemoteServiceGateway Gemini access Lens scripts use — that one is Lens-only and proxied
// by Snap. This is a plain Google AI Studio API key, stored as a Supabase secret named
// GOOGLE_AI_STUDIO_KEY (Edge Functions dashboard -> Secrets), created for free at
// aistudio.google.com — separate from anything Snap-related.
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

const MODEL = "gemini-3.1-flash-image";
const SEAMLESS_PROMPT =
  "Make this texture image tile seamlessly as a repeating pattern — remove any visible " +
  "seams at the edges so it can repeat infinitely in every direction. Keep the same " +
  "materials, colors, lighting, and level of detail. Do not add a border or frame.";

const MAX_IMAGE_BASE64_LENGTH = 12 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const image = (body as Record<string, unknown>)?.image;
  if (typeof image !== "string" || image.length < 100) {
    return json({ error: "missing or invalid image" }, 400);
  }
  if (image.length > MAX_IMAGE_BASE64_LENGTH) {
    return json({ error: "image too large" }, 413);
  }

  const apiKey = Deno.env.get("GOOGLE_AI_STUDIO_KEY");
  if (!apiKey) {
    return json({ error: "GOOGLE_AI_STUDIO_KEY secret is not configured on this project" }, 500);
  }

  let geminiRes: Response;
  try {
    geminiRes = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        input: [
          { type: "text", text: SEAMLESS_PROMPT },
          { type: "image", mime_type: "image/jpeg", data: image },
        ],
      }),
    });
  } catch (err) {
    return json({ error: "could not reach Gemini: " + String(err) }, 502);
  }

  if (!geminiRes.ok) {
    const errText = await geminiRes.text().catch(() => "");
    return json({ error: "Gemini API error " + geminiRes.status + ": " + errText.slice(0, 500) }, 502);
  }

  const data = await geminiRes.json();

  // This is a very new API (Interactions API) and Google's own docs don't spell out the
  // raw JSON field path for the output image anywhere we could pin down — so this tries
  // the couple of shapes suggested by their SDK docs, and if none match, returns enough
  // of the real response to fix this on the first actual call instead of guessing blind.
  const found = extractImageData(data);
  if (!found) {
    return json(
      {
        error: "could not find image data in Gemini response — shape unrecognized",
        responsePreview: JSON.stringify(data).slice(0, 1000),
      },
      502,
    );
  }

  return json({ image: found });
});

function extractImageData(data: unknown): string | null {
  const d = data as Record<string, unknown>;

  // Shape 1: a top-level `output_image` (or camelCase) convenience field.
  const outputImage = (d?.output_image ?? d?.outputImage) as Record<string, unknown> | undefined;
  if (outputImage && typeof outputImage.data === "string") return outputImage.data;

  // Shape 2: an interaction wrapper with the same field nested one level down.
  const interaction = d?.interaction as Record<string, unknown> | undefined;
  const nestedOutputImage = (interaction?.output_image ?? interaction?.outputImage) as
    | Record<string, unknown>
    | undefined;
  if (nestedOutputImage && typeof nestedOutputImage.data === "string") return nestedOutputImage.data;

  // Shape 3: walk a `steps` array for a model_output step containing an image content block.
  const steps = (d?.steps ?? interaction?.steps) as unknown[] | undefined;
  if (Array.isArray(steps)) {
    for (const step of steps) {
      const s = step as Record<string, unknown>;
      const blocks = (s?.content ?? s?.contentBlocks ?? []) as unknown[];
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) {
        const b = block as Record<string, unknown>;
        if (b?.type === "image" && typeof b?.data === "string") return b.data as string;
      }
    }
  }

  return null;
}
