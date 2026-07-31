import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateImagePayload } from "./validate.ts";

Deno.test("rejects missing body/field", () => {
  assertEquals(validateImagePayload(null).ok, false);
  assertEquals(validateImagePayload({}).ok, false);
  assertEquals(validateImagePayload({ notImage: "x" }).ok, false);
});

Deno.test("rejects non-string or too-short image", () => {
  assertEquals(validateImagePayload({ image: 123 }).ok, false);
  assertEquals(validateImagePayload({ image: "short" }).ok, false);
});

Deno.test("rejects oversized payload with 413", () => {
  const huge = "a".repeat(12 * 1024 * 1024 + 1);
  const result = validateImagePayload({ image: huge });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 413);
});

Deno.test("accepts a reasonable base64-ish payload", () => {
  const ok = "a".repeat(5000);
  const result = validateImagePayload({ image: ok });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.source, "capture");
    assertEquals(result.prompt, null);
  }
});

Deno.test("accepts an ai source with a prompt", () => {
  const image = "a".repeat(5000);
  const result = validateImagePayload({ image, source: "ai", prompt: "rusty metal" });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.source, "ai");
    assertEquals(result.prompt, "rusty metal");
  }
});

Deno.test("rejects an invalid source", () => {
  const image = "a".repeat(5000);
  assertEquals(validateImagePayload({ image, source: "bogus" }).ok, false);
});

Deno.test("rejects a non-string prompt", () => {
  const image = "a".repeat(5000);
  assertEquals(validateImagePayload({ image, prompt: 123 }).ok, false);
});

Deno.test("treats an empty prompt string as no prompt", () => {
  const image = "a".repeat(5000);
  const result = validateImagePayload({ image, prompt: "" });
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.prompt, null);
});
