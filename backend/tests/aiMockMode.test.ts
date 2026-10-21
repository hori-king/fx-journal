import assert from "node:assert/strict";
import test from "node:test";
import { runWithAIMockMode, shouldUseAIMockMode } from "../../src/services/aiMockMode.js";

test("enables mock only in development when explicitly requested", () => {
  assert.equal(shouldUseAIMockMode({ development: true, production: false, setting: "true" }), true);
  assert.equal(shouldUseAIMockMode({ development: true, production: false, setting: "false" }), false);
  assert.equal(shouldUseAIMockMode({ development: false, production: true, setting: "true" }), false);
  assert.equal(shouldUseAIMockMode({ development: true, production: true, setting: "true" }), false);
});

test("mock mode returns the fixture without invoking the live API request", async () => {
  let liveRequestCount = 0;
  const result = await runWithAIMockMode(
    true,
    () => ({ analysis: "sample" }),
    async () => {
      liveRequestCount += 1;
      return { analysis: "live" };
    },
  );
  assert.deepEqual(result, { analysis: "sample" });
  assert.equal(liveRequestCount, 0);
});

test("mock-off mode executes the normal API request", async () => {
  const result = await runWithAIMockMode(
    false,
    () => ({ analysis: "sample" }),
    async () => ({ analysis: "live" }),
  );
  assert.deepEqual(result, { analysis: "live" });
});
