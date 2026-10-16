import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import OpenAI from "openai";
import "dotenv/config";
import { AIUsageServiceError, finalizeAIUsage, runMeteredAIAnalysis, toAIUsageWindow, type AIAnalysisType } from "./aiUsage.js";

type AuthenticatedRequest = Request & { authUserId?: string };
type JsonObject = Record<string, unknown>;

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const frontendOrigin = process.env.FRONTEND_ORIGIN?.replace(/\/$/, "");
const allowedOrigins = new Set(
  isProduction
    ? frontendOrigin ? [frontendOrigin] : []
    : ["http://localhost:5173", "http://127.0.0.1:5173", ...(frontendOrigin ? [frontendOrigin] : [])],
);
const bodyLimit = "256kb";
const maxTrades = 100;
const rateLimitWindowMs = readPositiveInteger(process.env.AI_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000);
const rateLimitMax = readPositiveInteger(process.env.AI_RATE_LIMIT_MAX, 15);
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && !allowedOrigins.has(origin)) {
    res.status(403).json({ error: "このオリジンからのアクセスは許可されていません" });
    return;
  }
  next();
});
app.use(cors({ origin: [...allowedOrigins], methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json({ limit: bodyLimit, strict: true }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authorization = req.get("authorization");
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  if (!match || !supabaseUrl || !supabasePublishableKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  void fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabasePublishableKey,
      Authorization: `Bearer ${match[1]}`,
    },
    signal: AbortSignal.timeout(5000),
  }).then(async (response) => {
    if (!response.ok) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const user: unknown = await response.json();
    if (!isObject(user) || typeof user.id !== "string" || !user.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.authUserId = user.id;
    next();
  }).catch(() => {
    console.error("Supabase token verification failed");
    res.status(503).json({ error: "認証サービスに接続できません。時間をおいて再度お試しください。" });
  });
}

function rateLimitByUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const userId = req.authUserId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const now = Date.now();
  if (rateLimitBuckets.size > 10_000) {
    for (const [id, bucket] of rateLimitBuckets) {
      if (bucket.resetAt <= now) rateLimitBuckets.delete(id);
    }
  }
  const bucket = rateLimitBuckets.get(userId);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(userId, { count: 1, resetAt: now + rateLimitWindowMs });
    next();
    return;
  }
  if (bucket.count >= rateLimitMax) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    res.status(429).json({ error: "AI分析の利用回数が多すぎます。しばらく待ってから再度お試しください。" });
    return;
  }
  bucket.count += 1;
  next();
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonObject, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000_000;
}

function isString(value: unknown, maxLength: number, allowEmpty = true): value is string {
  return typeof value === "string" && value.length <= maxLength && (allowEmpty || value.trim().length > 0);
}

function validateTrade(value: unknown): value is JsonObject {
  if (!isObject(value)) return false;
  if (!hasOnlyKeys(value, ["symbol", "direction", "entry", "exit", "lot", "leverage", "timeframe", "reason", "methods", "takeProfit", "stopLoss", "profit", "profitCurrency", "priceMove", "priceMoveUnit", "rr", "result", "holdingTime", "entryTime", "exitTime"])) return false;
  return isString(value.symbol, 32, false)
    && (value.direction === "BUY" || value.direction === "SELL")
    && ["entry", "exit", "lot", "takeProfit", "stopLoss", "profit", "priceMove", "rr", "holdingTime"].every((key) => isFiniteNumber(value[key]))
    && (value.leverage === null || value.leverage === undefined || isFiniteNumber(value.leverage))
    && isString(value.timeframe, 24)
    && isString(value.reason, 1000)
    && (value.methods === undefined || (Array.isArray(value.methods) && value.methods.length <= 20 && value.methods.every((method) => isString(method, 64))))
    && isString(value.profitCurrency, 8, false)
    && isString(value.priceMoveUnit, 12, false)
    && (value.result === "WIN" || value.result === "LOSS" || value.result === "DRAW")
    && isString(value.entryTime, 64)
    && isString(value.exitTime, 64);
}

function validateFullAnalysis(body: unknown): body is JsonObject & { trades: JsonObject[] } {
  if (!isObject(body) || !hasOnlyKeys(body, ["summary", "directionAnalysis", "symbolAnalysis", "methodAnalysis", "trades"]) || !isObject(body.summary)) return false;
  if (!Array.isArray(body.directionAnalysis) || !Array.isArray(body.symbolAnalysis) || !Array.isArray(body.methodAnalysis)) return false;
  if (body.directionAnalysis.length > 2 || body.symbolAnalysis.length > maxTrades || body.methodAnalysis.length > maxTrades) return false;
  if (!body.directionAnalysis.every((item) => isObject(item) && hasOnlyKeys(item, ["direction", "totalTrades", "winCount", "winRate"]) && (item.direction === "BUY" || item.direction === "SELL") && [item.totalTrades, item.winCount, item.winRate].every(isFiniteNumber))) return false;
  if (!body.symbolAnalysis.every((item) => isObject(item) && hasOnlyKeys(item, ["symbol", "totalTrades", "winCount", "winRate"]) && isString(item.symbol, 32, false) && [item.totalTrades, item.winCount, item.winRate].every(isFiniteNumber))) return false;
  if (!body.methodAnalysis.every((item) => isObject(item) && hasOnlyKeys(item, ["method", "totalTrades", "winCount", "winRate"]) && isString(item.method, 64, false) && [item.totalTrades, item.winCount, item.winRate].every(isFiniteNumber))) return false;
  if (!Array.isArray(body.trades) || body.trades.length > maxTrades || !body.trades.every(validateTrade)) return false;
  const summary = body.summary;
  if (!hasOnlyKeys(summary, ["totalTrades", "winCount", "lossCount", "drawCount", "winRate", "totalProfit", "avgProfit", "profitByCurrency", "averageProfitByCurrency"])) return false;
  return ["totalTrades", "winCount", "lossCount", "drawCount", "winRate"].every((key) => isFiniteNumber(summary[key]))
    && (summary.totalProfit === null || isFiniteNumber(summary.totalProfit))
    && (summary.avgProfit === null || isFiniteNumber(summary.avgProfit))
    && isCurrencyTotals(summary.profitByCurrency)
    && isCurrencyTotals(summary.averageProfitByCurrency);
}

function isCurrencyTotals(value: unknown): value is JsonObject {
  return isObject(value) && Object.keys(value).length <= 20
    && Object.entries(value).every(([currency, amount]) => isString(currency, 8, false) && isFiniteNumber(amount));
}

function validateSingleAnalysis(body: unknown): body is JsonObject {
  return validateTrade(body);
}

function validateFullAnalysisResult(value: unknown): value is {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
} {
  return isObject(value)
    && hasOnlyKeys(value, ["summary", "strengths", "weaknesses", "improvements"])
    && isString(value.summary, 5000, false)
    && ["strengths", "weaknesses", "improvements"].every((key) =>
      Array.isArray(value[key]) && value[key].length <= 30 && value[key].every((item) => isString(item, 1000, false))
    );
}

function validateSingleAnalysisResult(value: unknown): value is {
  summary: string;
  goodPoints: string[];
  cautions: string[];
  improvements: string[];
} {
  return isObject(value)
    && hasOnlyKeys(value, ["summary", "goodPoints", "cautions", "improvements"])
    && isString(value.summary, 5000, false)
    && ["goodPoints", "cautions", "improvements"].every((key) =>
      Array.isArray(value[key]) && value[key].length <= 30 && value[key].every((item) => isString(item, 1000, false))
    );
}

async function runAIAnalysis<T>(
  req: AuthenticatedRequest,
  res: Response,
  analysisType: AIAnalysisType,
  endpoint: string,
  prompt: string,
  validateResult: (value: unknown) => value is T,
) {
  const userId = req.authUserId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let completedReservationId: string | null = null;

  try {
    const result = await runMeteredAIAnalysis<T>(
      userId,
      analysisType,
      async () => {
        const response = await openai.responses.create(
          { model: "gpt-5.6-luna", input: prompt },
          { timeout: 10 * 60 * 1000 },
        );
        const analysis: unknown = JSON.parse(response.output_text);
        if (req.aborted || res.destroyed) throw new Error("AI analysis response was interrupted");
        return analysis;
      },
      validateResult,
    );

    if (!result.allowed) {
      const usage = result.usage;
      const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(usage.resetAt) - Date.now()) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        error: "この利用期間のAI分析上限に達しました。",
        code: "AI_USAGE_LIMIT_REACHED",
        analysisType,
        plan: usage.plan,
        usedCount: usage.usedCount,
        limit: usage.limit,
        remaining: usage.remaining,
        ...toAIUsageWindow(usage),
      });
      return;
    }

    if (!result.usage.reservationId) throw new AIUsageServiceError();
    completedReservationId = result.usage.reservationId;
    if (req.aborted || res.destroyed) {
      await finalizeAIUsage(completedReservationId, false);
      completedReservationId = null;
      return;
    }

    let responseFinished = false;
    res.once("finish", () => {
      responseFinished = true;
    });
    res.once("close", () => {
      if (!responseFinished && completedReservationId) {
        void finalizeAIUsage(completedReservationId, false).catch(() => {
          console.error("Could not release AI usage after interrupted response", { userId, endpoint });
        });
      }
    });
    res.json({ analysis: result.analysis, usage: toAIUsageWindow(result.usage) });
  } catch (error) {
    if (completedReservationId) {
      try {
        await finalizeAIUsage(completedReservationId, false);
        completedReservationId = null;
      } catch {
        console.error("Could not release AI usage reservation", { userId, endpoint });
      }
    }

    if (req.aborted || res.destroyed || res.headersSent) return;
    if (error instanceof AIUsageServiceError) {
      res.status(503).json({ error: "AI利用状況を確認できません。時間をおいて再度お試しください。" });
      return;
    }
    console.error("AI analysis request failed", { userId, endpoint });
    res.status(500).json({ error: "AI分析中にエラーが発生しました" });
  }
}

function invalidInput(res: Response) {
  res.status(400).json({ error: "AI分析に必要なデータが正しくありません。入力内容をご確認ください。" });
}

app.get("/", (_req, res) => {
  res.json({ message: "AI分析バックエンドが起動しています" });
});

app.post("/api/ai-analysis", requireAuth, rateLimitByUser, async (req, res) => {
  if (!validateFullAnalysis(req.body)) {
    invalidInput(res);
    return;
  }
  await runAIAnalysis(req as AuthenticatedRequest, res, "all", "/api/ai-analysis", `
      以下はユーザーのFX取引分析データです。
      ${JSON.stringify(req.body, null, 2)}
      データには以下が含まれています。
      - summary：全体の集計結果
      - directionAnalysis：BUY / SELL別の分析
      - symbolAnalysis：銘柄別の分析
      - methodAnalysis：手法別の分析
      - trades：個別の取引データ
      これらのデータを使って、ユーザーの取引傾向を分析してください。
      特に以下を確認してください。
      1. 全体的な取引状況 2. 勝ちやすかった条件 3. 負けが発生した条件
      4. BUYとSELLの違い 5. 銘柄ごとの特徴 6. 手法ごとの特徴
      7. RRと結果の関係 8. 保有時間と結果の関係 9. データから確認できる改善ポイント
      必ず以下のJSON形式だけで回答してください。
      {"summary":"全体的な取引状況","strengths":["良かった特徴"],"weaknesses":["注意点"],"improvements":["改善ポイント"]}
      JSON以外の文章は出力しないでください。
      summaryや各分析結果に含まれる数値は基本的にそのまま使用し、存在しない数値を推測しないでください。
      取引件数が少ない場合はデータ不足と明記し、相関関係だけで因果関係があると断定しないでください。
      `, validateFullAnalysisResult);
});

app.post("/api/ai-analysis-single", requireAuth, rateLimitByUser, async (req, res) => {
  if (!validateSingleAnalysis(req.body)) {
    invalidInput(res);
    return;
  }
  await runAIAnalysis(req as AuthenticatedRequest, res, "single", "/api/ai-analysis-single", `
      以下はユーザーのFX取引分析データです。
      ${JSON.stringify(req.body, null, 2)}
      この1件の取引について分析してください。
      特に取引結果、RRと損益、エントリー条件、TP / SL、保有時間、BUY / SELL、根拠、良かった点、注意点、改善ポイントを確認してください。
      必ず以下のJSON形式だけで回答してください。
      {"summary":"この取引の総合的な分析","goodPoints":["良かった点"],"cautions":["注意点"],"improvements":["改善ポイント"]}
      JSON以外の文章は出力しないでください。
      データに存在しない事実を作らず、チャートから判断したような説明をせず、1件だけの取引から一般的な傾向や将来の利益・勝率を断定せず、投資判断や売買推奨をしないでください。
      `, validateSingleAnalysisResult);
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  void _next;
  if (isObject(error) && error.type === "entity.too.large") {
    res.status(413).json({ error: "送信データが大きすぎます。分析対象を減らして再度お試しください。" });
    return;
  }
  if (isObject(error) && error.type === "entity.parse.failed") {
    res.status(400).json({ error: "リクエスト形式が正しくありません。" });
    return;
  }
  console.error("Request processing failed");
  res.status(500).json({ error: "サーバー側でエラーが発生しました" });
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`Backend server started on port ${port}`);
});
