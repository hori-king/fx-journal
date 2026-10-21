import assert from "node:assert/strict";
import test from "node:test";
import { AIUsageResetError, resetTestUserAIUsage } from "../src/aiUsageAdmin.js";

const testUserId = "123e4567-e89b-42d3-a456-426614174000";

test("requires the exact allowlisted test user and confirmation before deletion", async () => {
  let fetchCount = 0;
  const fetcher: typeof fetch = async () => {
    fetchCount += 1;
    return new Response("[]", { status: 200 });
  };

  await assert.rejects(resetTestUserAIUsage({
    supabaseUrl: "https://project.supabase.co",
    serviceRoleKey: "service-role-secret",
    targetUserId: "123e4567-e89b-42d3-a456-426614174001",
    allowedTestUserId: testUserId,
    confirmation: `RESET ${testUserId}`,
    fetcher,
  }), AIUsageResetError);
  await assert.rejects(resetTestUserAIUsage({
    supabaseUrl: "https://project.supabase.co",
    serviceRoleKey: "service-role-secret",
    targetUserId: testUserId,
    allowedTestUserId: testUserId,
    confirmation: "yes",
    fetcher,
  }), AIUsageResetError);
  assert.equal(fetchCount, 0);
});

test("deletes only the allowlisted user's AI usage and returns the deleted count", async () => {
  let requestUrl: URL | null = null;
  let authorization: string | null = null;
  let apiKey: string | null = null;
  const deletedCount = await resetTestUserAIUsage({
    supabaseUrl: "https://project.supabase.co/",
    serviceRoleKey: "service-role-secret",
    targetUserId: testUserId,
    allowedTestUserId: testUserId,
    confirmation: `RESET ${testUserId}`,
    fetcher: async (input, init) => {
      requestUrl = new URL(input.toString());
      authorization = new Headers(init?.headers).get("authorization");
      apiKey = new Headers(init?.headers).get("apikey");
      return new Response(JSON.stringify([{ id: "one" }, { id: "two" }]), { status: 200 });
    },
  });
  assert.equal(requestUrl?.pathname, "/rest/v1/ai_usage");
  assert.equal(requestUrl?.searchParams.get("user_id"), `eq.${testUserId}`);
  assert.equal(requestUrl?.searchParams.get("select"), "id");
  assert.equal(authorization, "Bearer service-role-secret");
  assert.equal(apiKey, "service-role-secret");
  assert.equal(deletedCount, 2);
});

test("reports Supabase permission errors without exposing credentials", async () => {
  await assert.rejects(resetTestUserAIUsage({
    supabaseUrl: "https://project.supabase.co",
    serviceRoleKey: "service-role-secret",
    targetUserId: testUserId,
    allowedTestUserId: testUserId,
    confirmation: `RESET ${testUserId}`,
    fetcher: async () => new Response("permission denied", { status: 403 }),
  }), (error: unknown) => {
    assert.ok(error instanceof AIUsageResetError);
    assert.equal(error.message, "Supabaseで利用履歴を削除できませんでした（HTTP 403）。");
    assert.equal(error.message.includes("service-role-secret"), false);
    return true;
  });
});
