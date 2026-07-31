import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { clampLimit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "./list.ts";

Deno.test("clampLimit falls back to default for missing/invalid input", () => {
  assertEquals(clampLimit(null), DEFAULT_LIST_LIMIT);
  assertEquals(clampLimit(""), DEFAULT_LIST_LIMIT);
  assertEquals(clampLimit("not a number"), DEFAULT_LIST_LIMIT);
  assertEquals(clampLimit("0"), DEFAULT_LIST_LIMIT);
  assertEquals(clampLimit("-5"), DEFAULT_LIST_LIMIT);
});

Deno.test("clampLimit passes through valid values under the max", () => {
  assertEquals(clampLimit("10"), 10);
  assertEquals(clampLimit("1"), 1);
});

Deno.test("clampLimit caps at MAX_LIST_LIMIT", () => {
  assertEquals(clampLimit("9999"), MAX_LIST_LIMIT);
});
