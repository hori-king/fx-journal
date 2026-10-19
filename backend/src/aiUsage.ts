export type AIAnalysisType = "single" | "all";
export type AIPlan = "free" | "pro";

export type AIUsageWindow = {
  periodStart: string;
  periodEnd: string;
  resetAt: string;
  timeZone: "Asia/Tokyo";
};

export type AIUsageClaim = {
  allowed: boolean;
  reservationId: string | null;
  plan: AIPlan;
  analysisType: AIAnalysisType;
  usedCount: number;
  limit: number;
  remaining: number;
  periodStart: string;
  resetAt: string;
};

export class AIUsageServiceError extends Error {
  constructor() {
    super("AI利用状況を確認できませんでした");
    this.name = "AIUsageServiceError";
  }
}

type AIUsageOperations = {
  claim: typeof claimAIUsage;
  finalize: typeof finalizeAIUsage;
};

export type MeteredAIResult<T> =
  | { allowed: false; usage: AIUsageClaim }
  | { allowed: true; usage: AIUsageClaim; analysis: T };

export function formatJstTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new AIUsageServiceError();
  const jstWallClock = new Date(timestamp + 9 * 60 * 60 * 1000).toISOString();
  return `${jstWallClock.slice(0, -1)}+09:00`;
}

export function toAIUsageWindow(usage: AIUsageClaim): AIUsageWindow {
  const periodStart = formatJstTimestamp(usage.periodStart);
  const periodEnd = formatJstTimestamp(usage.resetAt);
  return { periodStart, periodEnd, resetAt: periodEnd, timeZone: "Asia/Tokyo" };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUsageClaim(value: unknown): value is AIUsageClaim {
  return isObject(value)
    && typeof value.allowed === "boolean"
    && (value.reservationId === null || typeof value.reservationId === "string")
    && (value.plan === "free" || value.plan === "pro")
    && (value.analysisType === "single" || value.analysisType === "all")
    && Number.isInteger(value.usedCount)
    && Number.isInteger(value.limit)
    && Number.isInteger(value.remaining)
    && typeof value.periodStart === "string"
    && typeof value.resetAt === "string";
}

async function callUsageRPC<T>(functionName: string, body: Record<string, unknown>, isValid: (value: unknown) => value is T): Promise<T> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("AI usage RPC configuration is missing", {
      functionName,
      missing: [!url && "SUPABASE_URL", !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean),
    });
    throw new AIUsageServiceError();
  }

  let response: Response;
  try {
    response = await fetch(`${url}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    console.error("AI usage RPC transport failed", {
      functionName,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw new AIUsageServiceError();
  }

  if (!response.ok) {
    let code: string | undefined;
    let message: string | undefined;
    try {
      const payload: unknown = await response.json();
      if (isObject(payload)) {
        if (typeof payload.code === "string" && /^[A-Za-z0-9_.-]{1,32}$/.test(payload.code)) code = payload.code;
        if (typeof payload.message === "string") {
          message = payload.message
            .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
            .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted]")
            .slice(0, 300);
        }
      }
    } catch {
      // エラーレスポンス本文がJSONでなくても、ステータスだけ記録する。
    }
    console.error("AI usage RPC rejected", { functionName, status: response.status, code, message });
    throw new AIUsageServiceError();
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    console.error("AI usage RPC returned invalid JSON", { functionName, status: response.status });
    throw new AIUsageServiceError();
  }
  if (!isValid(value)) {
    console.error("AI usage RPC returned an unexpected shape", {
      functionName,
      valueType: Array.isArray(value) ? "array" : value === null ? "null" : typeof value,
      keys: isObject(value) ? Object.keys(value).slice(0, 20) : undefined,
    });
    throw new AIUsageServiceError();
  }
  return value;
}

export function claimAIUsage(userId: string, analysisType: AIAnalysisType): Promise<AIUsageClaim> {
  return callUsageRPC("claim_ai_usage", { p_user_id: userId, p_analysis_type: analysisType }, isUsageClaim);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function finalizeAIUsage(reservationId: string, succeeded: boolean): Promise<boolean> {
  return callUsageRPC("finalize_ai_usage", { p_usage_id: reservationId, p_succeeded: succeeded }, isBoolean)
    .then((finalized) => {
      if (!finalized) console.error("AI usage finalization found no active reservation", { functionName: "finalize_ai_usage" });
      return finalized;
    });
}

export async function runMeteredAIAnalysis<T>(
  userId: string,
  analysisType: AIAnalysisType,
  analyze: () => Promise<unknown>,
  validateResult: (value: unknown) => value is T,
  operations: AIUsageOperations = { claim: claimAIUsage, finalize: finalizeAIUsage },
): Promise<MeteredAIResult<T>> {
  const usage = await operations.claim(userId, analysisType);
  if (!usage.allowed || !usage.reservationId) return { allowed: false, usage };

  try {
    const candidate = await analyze();
    if (!validateResult(candidate)) throw new Error("AI analysis result did not match the expected response shape");

    const finalized = await operations.finalize(usage.reservationId, true);
    if (!finalized) throw new AIUsageServiceError();
    return { allowed: true, usage, analysis: candidate };
  } catch (error) {
    try {
      await operations.finalize(usage.reservationId, false);
    } catch {
      console.error("Could not release AI usage reservation", { userId, analysisType });
    }
    throw error;
  }
}
