import assert from "node:assert/strict";
import test from "node:test";
import {
  runMeteredAIAnalysis,
  formatJstTimestamp,
  toAIUsageWindow,
  type AIUsageClaim,
} from "../src/aiUsage.js";

test("usage timestamps are returned as JST offsets without changing the instant", () => {
  assert.equal(formatJstTimestamp("2026-10-31T15:00:00.000Z"), "2026-11-01T00:00:00.000+09:00");
  assert.equal(Date.parse(formatJstTimestamp("2026-10-31T15:00:00.000Z")), Date.parse("2026-10-31T15:00:00.000Z"));
  assert.deepEqual(toAIUsageWindow(allowedClaim), {
    periodStart: "2026-10-01T09:00:00.000+09:00",
    periodEnd: "2026-11-01T09:00:00.000+09:00",
    resetAt: "2026-11-01T09:00:00.000+09:00",
    timeZone: "Asia/Tokyo",
  });
});

const allowedClaim: AIUsageClaim = {
  allowed: true,
  reservationId: "usage-reservation-1",
  plan: "free",
  analysisType: "single",
  usedCount: 1,
  limit: 3,
  remaining: 2,
  periodStart: "2026-10-01T00:00:00.000Z",
  resetAt: "2026-11-01T00:00:00.000Z",
};

function testOperations(
  claim: AIUsageClaim,
  events: string[],
  finalizeResult = true,
) {
  return {
    claim: async (_userId: string, analysisType: "single" | "all") => {
      events.push(`claim:${analysisType}`);
      return claim;
    },
    finalize: async (reservationId: string, succeeded: boolean) => {
      events.push(`finalize:${reservationId}:${succeeded}`);
      return finalizeResult;
    },
  };
}

test("successful valid analysis is finalized as one use", async () => {
  const events: string[] = [];
  const expected = { summary: "ok" };
  const result = await runMeteredAIAnalysis(
    "user-1",
    "single",
    async () => {
      events.push("analyze");
      return expected;
    },
    (value): value is typeof expected => typeof value === "object" && value !== null && "summary" in value,
    testOperations(allowedClaim, events),
  );

  assert.deepEqual(events, ["claim:single", "analyze", "finalize:usage-reservation-1:true"]);
  assert.equal(result.allowed, true);
  if (result.allowed) assert.equal(result.analysis, expected);
});

test("analysis error releases the reservation without consuming usage", async () => {
  const events: string[] = [];

  await assert.rejects(
    runMeteredAIAnalysis(
      "user-1",
      "all",
      async () => {
        events.push("analyze");
        throw new Error("OpenAI unavailable");
      },
      (value): value is string => typeof value === "string",
      testOperations({ ...allowedClaim, analysisType: "all" }, events),
    ),
  );

  assert.deepEqual(events, ["claim:all", "analyze", "finalize:usage-reservation-1:false"]);
});

test("invalid analysis result releases the reservation", async () => {
  const events: string[] = [];

  await assert.rejects(
    runMeteredAIAnalysis(
      "user-1",
      "single",
      async () => {
        events.push("analyze");
        return "not valid";
      },
      (value): value is number => typeof value === "number",
      testOperations(allowedClaim, events),
    ),
    /expected response shape/,
  );

  assert.deepEqual(events, ["claim:single", "analyze", "finalize:usage-reservation-1:false"]);
});

test("limit denial skips AI call and does not finalize a reservation", async () => {
  const events: string[] = [];
  const deniedClaim: AIUsageClaim = {
    ...allowedClaim,
    allowed: false,
    reservationId: null,
    usedCount: 3,
    remaining: 0,
  };

  const result = await runMeteredAIAnalysis(
    "user-1",
    "single",
    async () => {
      events.push("analyze");
      return "unexpected";
    },
    (value): value is string => typeof value === "string",
    testOperations(deniedClaim, events),
  );

  assert.deepEqual(events, ["claim:single"]);
  assert.equal(result.allowed, false);
});
