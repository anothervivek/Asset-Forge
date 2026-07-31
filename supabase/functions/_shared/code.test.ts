import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateCode, isValidCode } from "./code.ts";

Deno.test("generateCode produces 4 chars from the safe alphabet only", () => {
  for (let i = 0; i < 2000; i++) {
    const code = generateCode();
    assertEquals(code.length, 4);
    assert(isValidCode(code), `code "${code}" should be valid`);
    for (const ambiguous of ["I", "O", "0", "1"]) {
      assert(!code.includes(ambiguous), `code "${code}" must not contain "${ambiguous}"`);
    }
  }
});

Deno.test("isValidCode rejects wrong length and bad characters", () => {
  assertEquals(isValidCode("ABC"), false);
  assertEquals(isValidCode("ABCDE"), false);
  assertEquals(isValidCode("AI0O"), false); // contains ambiguous chars
  assertEquals(isValidCode("K4TQ"), true);
});

Deno.test("generateCode has reasonable spread across many draws (no obvious bias/collapse)", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 5000; i++) seen.add(generateCode());
  // alphabet^4 = 33^4 = 1,185,921 possible codes; 5000 draws should produce well
  // over 4900 distinct values if generation isn't degenerate.
  assert(seen.size > 4900, `expected high uniqueness, got ${seen.size}/5000`);
});
