import assert from "node:assert/strict";
import test from "node:test";
import {
  runMeteredAIAnalysis,
  getAIUsageStatus,
  AIUsageServiceError,
  formatJstTimestamp,
  toAIUsageWindow,
  type AIUsageClaim,
} from "../src/aiUsage.js";

test("AI usage status reads through the service-role RPC using only the authenticated ID supplied by the backend", async (t) => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  t.after(() => {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  });
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-secret";
  let requestedUrl = "";
  let requestedBody: unknown;
  let requestedAuthorization = "";
  const fetcher: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedBody = JSON.parse(String(init?.body));
    requestedAuthorization = new Headers(init?.headers).get("Authorization") ?? "";
    return Response.json({
      plan: "pro",
      periodStart: "2026-10-01T00:00:00Z",
      periodEnd: "2026-11-01T00:00:00Z",
      proStartedAt: "2026-10-01T00:00:00Z",
      proEndsAt: "2026-11-01T00:00:00Z",
      autoRenew: true,
      cancelAtPeriodEnd: false,
      single: { usedCount: 2, limit: 20, remaining: 18 },
      all: { usedCount: 1, limit: 5, remaining: 4 },
    });
  };

  const result = await getAIUsageStatus("verified-user-id", fetcher);
  assert.equal(requestedUrl, "https://example.supabase.co/rest/v1/rpc/get_ai_usage_status");
  assert.deepEqual(requestedBody, { p_user_id: "verified-user-id" });
  assert.equal(requestedAuthorization, "Bearer test-only-secret");
  assert.equal(result.single.usedCount, 2);
  assert.equal(result.all.limit, 5);
});

test("AI usage status rejects unexpected RPC limits", async (t) => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  t.after(() => {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  });
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-secret";
  const fetcher: typeof fetch = async () => Response.json({
    plan: "free",
    periodStart: "2026-10-01T00:00:00Z",
    periodEnd: "2026-11-01T00:00:00Z",
    proStartedAt: null,
    proEndsAt: null,
    autoRenew: false,
    cancelAtPeriodEnd: false,
    single: { usedCount: 0, limit: 20, remaining: 20 },
    all: { usedCount: 0, limit: 1, remaining: 1 },
  });
  await assert.rejects(getAIUsageStatus("verified-user-id", fetcher), AIUsageServiceError);
});

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
