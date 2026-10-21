import { supabase } from "../lib/supabaseClient";

export type AIUsageQuota = {
  usedCount: number;
  limit: number;
  remaining: number;
};

export type AIUsageStatus = {
  plan: "free" | "pro";
  periodStart: string;
  periodEnd: string;
  proStartedAt: string | null;
  proEndsAt: string | null;
  autoRenew: boolean;
  cancelAtPeriodEnd: boolean;
  single: AIUsageQuota;
  all: AIUsageQuota;
};

const apiBaseUrl = import.meta.env.VITE_AI_API_URL?.replace(/\/+$/, "")
  || (import.meta.env.DEV ? "http://localhost:3001" : "");

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isQuota(value: unknown, limit: number): value is AIUsageQuota {
  return isObject(value)
    && Number.isInteger(value.usedCount)
    && Number.isInteger(value.limit)
    && value.limit === limit
    && Number.isInteger(value.remaining)
    && (value.usedCount as number) >= 0
    && (value.remaining as number) >= 0;
}

function isAIUsageStatus(value: unknown): value is AIUsageStatus {
  if (!isObject(value) || (value.plan !== "free" && value.plan !== "pro")) return false;
  const proPlan = value.plan === "pro";
  return typeof value.periodStart === "string"
    && Number.isFinite(Date.parse(value.periodStart))
    && typeof value.periodEnd === "string"
    && Number.isFinite(Date.parse(value.periodEnd))
    && (value.proStartedAt === null || typeof value.proStartedAt === "string")
    && (value.proEndsAt === null || typeof value.proEndsAt === "string")
    && typeof value.autoRenew === "boolean"
    && typeof value.cancelAtPeriodEnd === "boolean"
    && isQuota(value.single, proPlan ? 20 : 3)
    && isQuota(value.all, proPlan ? 5 : 1);
}

export async function loadMyAIUsageStatus(): Promise<AIUsageStatus> {
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) throw new Error("ログイン状態を確認してください。");
  if (!apiBaseUrl) throw new Error("契約情報サービスのURLが設定されていません。");

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/ai-usage`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new Error("契約情報を取得できません。時間をおいて再度お試しください。");
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isObject(body) && typeof body.error === "string" ? body.error : null;
    throw new Error(message ?? "契約情報を取得できませんでした。");
  }
  if (!isAIUsageStatus(body)) throw new Error("契約情報の形式を確認できませんでした。");
  return body;
}
