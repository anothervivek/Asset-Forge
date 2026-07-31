const MAX_IMAGE_BASE64_LENGTH = 12 * 1024 * 1024; // ~12MB body cap per spec
const MIN_IMAGE_BASE64_LENGTH = 100; // guards against empty/near-empty payloads
const MAX_PROMPT_LENGTH = 2000;

export type ValidationResult =
  | { ok: true; image: string; source: "capture" | "ai"; prompt: string | null }
  | { ok: false; status: number; error: string };

// `source`/`prompt` are optional and default to a pinch-captured photo's shape (source
// "capture", no prompt) — TextureGrab.ts's existing upload calls never send either field
// and keep working unchanged. GeminiTextureGenerate.ts sends source "ai" (and the prompt
// that produced the image) so the web companion can skip PBR-map derivation for it and
// show it as a flat, ready-to-download image instead — see migration 0004_grab_source.sql.
export function validateImagePayload(body: unknown): ValidationResult {
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
