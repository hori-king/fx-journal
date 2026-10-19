import { supabase } from "../lib/supabaseClient";
import { createAIAnalysisDataset, type Trade } from "../tradeData";

export type AIAnalysis = {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
};

export type SingleAIAnalysis = {
  summary: string;
  goodPoints: string[];
  cautions: string[];
  improvements: string[];
};

export type AIUsageWindow = {
  periodStart: string;
  periodEnd: string;
  resetAt: string;
  timeZone: "Asia/Tokyo";
};

export type AIAnalysisResponse<T> = { analysis: T; usage: AIUsageWindow };

const apiBaseUrl = import.meta.env.VITE_AI_API_URL?.replace(/\/+$/, "")
  || (import.meta.env.DEV ? "http://localhost:3001" : "");

function getEndpoint(path: string): string {
  if (!apiBaseUrl) {
    throw new Error("AI分析APIのURLが設定されていません。管理者にお問い合わせください。");
  }
  return `${apiBaseUrl}${path}`;
}

async function postAnalysis<T>(path: string, payload: unknown): Promise<AIAnalysisResponse<T>> {
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) throw new Error("ログインが必要です。再度ログインしてください。");

  let response: Response;
  try {
    response = await fetch(getEndpoint(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("AI分析サーバーに接続できません。時間をおいて再度お試しください。");
  }

  const responseBody: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const apiMessage = typeof responseBody === "object" && responseBody !== null && "error" in responseBody
      && typeof responseBody.error === "string" ? responseBody.error : null;
    if (response.status === 400 || response.status === 413) {
      throw new Error(apiMessage ?? "AI分析に必要なデータが正しくありません。");
    }
    if (response.status === 401) throw new Error("ログイン情報を確認できません。再度ログインしてください。");
    if (response.status === 503) {
      throw new Error(apiMessage ?? "AI利用状況サービスに接続できません。時間をおいて再度お試しください。");
    }
    if (response.status === 429) {
      const resetAt = typeof responseBody === "object" && responseBody !== null && "resetAt" in responseBody
        && typeof responseBody.resetAt === "string" ? responseBody.resetAt : null;
      const resetLabel = resetAt && Number.isFinite(Date.parse(resetAt))
        ? ` リセット日時（日本時間）：${new Intl.DateTimeFormat("ja-JP", {
          timeZone: "Asia/Tokyo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(resetAt))}`
        : "";
      throw new Error(`${apiMessage ?? "AI分析の利用回数が多すぎます。"}${resetLabel}`);
    }
    throw new Error("AI分析中にエラーが発生しました。時間をおいて再度お試しください。");
  }

  if (typeof responseBody !== "object" || responseBody === null || !("analysis" in responseBody)) {
    throw new Error("AI分析結果を読み込めませんでした。");
  }
  if (!("usage" in responseBody) || typeof responseBody.usage !== "object" || responseBody.usage === null) {
    throw new Error("AI分析の利用期間を読み込めませんでした。");
  }
  const usage = responseBody.usage;
  if (!("periodStart" in usage) || typeof usage.periodStart !== "string"
    || !("periodEnd" in usage) || typeof usage.periodEnd !== "string"
    || !("resetAt" in usage) || typeof usage.resetAt !== "string"
    || !("timeZone" in usage) || usage.timeZone !== "Asia/Tokyo") {
    throw new Error("AI分析の利用期間を読み込めませんでした。");
  }
  return { analysis: responseBody.analysis as T, usage: usage as AIUsageWindow };
}

export async function requestFullAIAnalysis(trades: Trade[]): Promise<AIAnalysisResponse<AIAnalysis>> {
  const latestTrades = [...trades]
    .sort((left, right) => new Date(right.entryTime).getTime() - new Date(left.entryTime).getTime())
    .slice(0, 100);
  return postAnalysis<AIAnalysis>("/api/ai-analysis", createAIAnalysisDataset(latestTrades));
}

export async function requestSingleAIAnalysis(trade: Trade, priceMove: number, priceMoveUnit: string): Promise<AIAnalysisResponse<SingleAIAnalysis>> {
  return postAnalysis<SingleAIAnalysis>("/api/ai-analysis-single", {
    symbol: trade.symbol,
    direction: trade.direction,
    entry: trade.entry,
    exit: trade.exit,
    lot: trade.lot,
    leverage: trade.leverage ?? null,
    timeframe: trade.timeframe,
    reason: trade.reason,
    methods: trade.methods,
    takeProfit: trade.takeProfit,
    stopLoss: trade.stopLoss,
    profit: trade.profit,
    profitCurrency: trade.profitCurrency ?? "JPY",
    priceMove,
    priceMoveUnit,
    rr: trade.rr,
    result: trade.result,
    holdingTime: trade.holdingTime,
    entryTime: trade.entryTime,
    exitTime: trade.exitTime,
  });
}
