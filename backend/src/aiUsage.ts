export type AIAnalysisType = "single" | "all";
export type AIPlan = "free" | "pro";

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
  if (!url || !serviceRoleKey) throw new AIUsageServiceError();

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
  } catch {
    throw new AIUsageServiceError();
  }

  if (!response.ok) {
    console.error("AI usage database request failed", { functionName, status: response.status });
    throw new AIUsageServiceError();
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new AIUsageServiceError();
  }
  if (!isValid(value)) throw new AIUsageServiceError();
  return value;
}

export function claimAIUsage(userId: string, analysisType: AIAnalysisType): Promise<AIUsageClaim> {
  return callUsageRPC("claim_ai_usage", { p_user_id: userId, p_analysis_type: analysisType }, isUsageClaim);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function finalizeAIUsage(reservationId: string, succeeded: boolean): Promise<boolean> {
  return callUsageRPC("finalize_ai_usage", { p_usage_id: reservationId, p_succeeded: succeeded }, isBoolean);
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
