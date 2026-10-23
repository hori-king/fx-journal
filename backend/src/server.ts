import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import OpenAI from "openai";
import "dotenv/config";
import { AIUsageServiceError, finalizeAIUsage, getAIUsageStatus, runMeteredAIAnalysis, toAIUsageWindow, type AIAnalysisType } from "./aiUsage.js";
import { ChartImageLoadError, loadOwnedTradeChartImages, type AIChartImage } from "./chartImages.js";
import { createProCheckout, handleStripeWebhook, StripeBillingError } from "./stripeBilling.js";

type AuthenticatedRequest = Request & { authUserId?: string; authAccessToken?: string; authEmail?: string };
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

// Stripe署名検証には未加工のbodyが必要なため、このrouteはexpress.jsonより前に登録する。
app.post("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  if (!Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: "Webhook本文が正しくありません。" });
    return;
  }
  try {
    await handleStripeWebhook(req.body, req.get("stripe-signature"));
    res.status(200).json({ received: true });
  } catch (error) {
    if (error instanceof StripeBillingError) {
      console.error("Stripe webhook rejected", { status: error.statusCode, errorName: error.name });
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error("Stripe webhook processing failed");
    res.status(500).json({ error: "Webhookを処理できませんでした。" });
  }
});

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
    req.authAccessToken = match[1];
    req.authEmail = typeof user.email === "string" ? user.email : undefined;
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

function validateSingleAnalysis(body: unknown): body is JsonObject & { tradeId: string } {
  if (!isObject(body) || typeof body.tradeId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.tradeId)) return false;
  const trade = { ...body };
  delete trade.tradeId;
  return validateTrade(trade);
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

function validateSingleAnalysisResult(value: unknown, requiresImageFindings = false): value is {
  summary: string;
  goodPoints: string[];
  improvements: string[];
  nextAction: string;
  details: {
    entryEvaluation: string;
    exitEvaluation: string;
    trend: string;
    supportResistance: string;
    strategyConsistency: string;
    imageFindings?: string[];
    imageLimitations?: string[];
  };
} {
  if (!isObject(value)) return false;
  const details = value.details;
  if (!isObject(details)) return false;
  const allowedKeys = ["summary", "goodPoints", "improvements", "nextAction", "details"];
  const detailKeys = ["entryEvaluation", "exitEvaluation", "trend", "supportResistance", "strategyConsistency", "imageFindings", "imageLimitations"];
  const hasImageFindings = Array.isArray(details.imageFindings)
      && details.imageFindings.length <= 5
      && details.imageFindings.every((item) => isString(item, 240, false));
  const hasImageLimitations = Array.isArray(details.imageLimitations)
      && details.imageLimitations.length <= 5
      && details.imageLimitations.every((item) => isString(item, 240, false));
  const hasValidImageFindings = requiresImageFindings
    ? hasImageFindings && hasImageLimitations
    : (details.imageFindings === undefined || hasImageFindings)
      && (details.imageLimitations === undefined || hasImageLimitations);
  return hasOnlyKeys(value, allowedKeys)
    && hasOnlyKeys(details, detailKeys)
    && isString(value.summary, 360, false)
    && Array.isArray(value.goodPoints)
    && value.goodPoints.length <= 2
    && value.goodPoints.every((item) => isString(item, 180, false))
    && Array.isArray(value.improvements)
    && value.improvements.length <= 2
    && value.improvements.every((item) => isString(item, 180, false))
    && isString(value.nextAction, 180, false)
    && ["entryEvaluation", "exitEvaluation", "trend", "supportResistance", "strategyConsistency"].every((key) =>
      isString(details[key], 240, false)
    )
    && hasValidImageFindings;
}

async function runAIAnalysis<T>(
  req: AuthenticatedRequest,
  res: Response,
  analysisType: AIAnalysisType,
  endpoint: string,
  prompt: string,
  validateResult: (value: unknown) => value is T,
  chartImages: AIChartImage[] = [],
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
        const input = chartImages.length > 0
          ? [{
            role: "user" as const,
            content: [
              { type: "input_text" as const, text: prompt },
              ...chartImages.map((image) => ({
                type: "input_image" as const,
                image_url: image.dataUrl,
                detail: "high" as const,
              })),
            ],
          }]
          : prompt;
        const response = await openai.responses.create(
          { model: "gpt-5.6-luna", input, ...(analysisType === "single" ? { store: false } : {}) },
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
      console.error("AI usage service unavailable", { endpoint });
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

app.get("/api/ai-usage", requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).authUserId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    res.json(await getAIUsageStatus(userId));
  } catch (error) {
    if (error instanceof AIUsageServiceError) {
      console.error("AI usage status unavailable", { endpoint: "/api/ai-usage" });
      res.status(503).json({ error: "AI利用状況を取得できません。時間をおいて再度お試しください。" });
      return;
    }
    console.error("AI usage status request failed", { endpoint: "/api/ai-usage" });
    res.status(500).json({ error: "契約情報を取得できませんでした。" });
  }
});

app.post("/api/billing/checkout", requireAuth, async (req, res) => {
  const authenticated = req as AuthenticatedRequest;
  if (!authenticated.authUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const url = await createProCheckout(authenticated.authUserId, authenticated.authEmail);
    res.status(200).json({ url });
  } catch (error) {
    if (error instanceof StripeBillingError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error("Stripe Checkout creation failed", { endpoint: "/api/billing/checkout" });
    res.status(503).json({ error: "決済画面を開始できませんでした。時間をおいて再度お試しください。" });
  }
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
  const requestBody: unknown = req.body;
  if (!validateSingleAnalysis(requestBody)) {
    invalidInput(res);
    return;
  }
  const authenticatedRequest = req as AuthenticatedRequest;
  if (!authenticatedRequest.authAccessToken) {
    res.status(401).json({ error: "ログイン状態を確認できません。再度ログインしてください。" });
    return;
  }

  let chartImages: AIChartImage[];
  try {
    chartImages = await loadOwnedTradeChartImages(requestBody.tradeId, authenticatedRequest.authAccessToken);
  } catch (error) {
    if (error instanceof ChartImageLoadError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error("Trade chart image loading failed", { endpoint: "/api/ai-analysis-single" });
    res.status(503).json({ error: "チャート画像を読み込めませんでした。時間をおいて再度お試しください。" });
    return;
  }

  const chartContext = chartImages.length > 0 ? `
      添付された${chartImages.length}枚の取引チャート画像も、この取引データと合わせて分析してください。
      詳細分析は一般論で済ませず、目視できるローソク足の動き、時間足表示、価格目盛り、描画されたラインやエントリー/決済マークなど、具体的な視覚的根拠を挙げてください。その根拠が取引データとどう一致・不一致なのかを説明してください。
      エントリー位置・決済位置・トレンド・サポート/レジスタンスを確認してください。該当箇所や数値が画像で判別できない場合は断定せず、「画像では確認できないこと」に分けてください。
      「画像から読み取れたこと」「画像では確認できないこと」は各最大3件に絞り、各項目を短く具体的にしてください。画像上の価格や時間を読み違える可能性にも留意してください。
      ` : "";
  const tradeDataForAI: JsonObject = {};
  for (const [key, value] of Object.entries(requestBody)) {
    if (key !== "tradeId") tradeDataForAI[key] = value;
  }

  await runAIAnalysis(authenticatedRequest, res, "single", "/api/ai-analysis-single", `
      以下はユーザーのFX取引分析データです。
      ${JSON.stringify(tradeDataForAI, null, 2)}
      ${chartContext}
      この1件の取引を振り返り、まず短い要約を作成してください。長文や同じ内容の繰り返しは避けてください。
      summaryは2〜3文、goodPointsは最大2件、improvementsは最大2件、nextActionは次回に実行できる具体的な行動を1件だけにしてください。各文は短く、原則1項目1文にしてください。
      detailsにはentryEvaluation（エントリー評価）、exitEvaluation（利確・損切り評価）、trend（トレンド）、supportResistance（サポート/レジスタンス）、strategyConsistency（手法との整合性）をそれぞれ1〜2文で入れてください。取引データから分からない項目は、判断できない理由を短く示してください。
      画像がある場合だけ、detailsにimageFindingsとimageLimitationsを追加し、各最大3件の短い箇条書きにしてください。
      必ず以下のJSON形式だけで回答してください。
      ${chartImages.length > 0
    ? '{"summary":"2〜3文の総評","goodPoints":["良かった点。最大2件"],"improvements":["改善点。最大2件"],"nextAction":"次回意識すること。1件","details":{"entryEvaluation":"エントリー評価","exitEvaluation":"利確・損切り評価","trend":"トレンド","supportResistance":"サポート/レジスタンス","strategyConsistency":"手法との整合性","imageFindings":["画像で確認できた具体的な根拠"],"imageLimitations":["画像では確認できないこと"]}}'
    : '{"summary":"2〜3文の総評","goodPoints":["良かった点。最大2件"],"improvements":["改善点。最大2件"],"nextAction":"次回意識すること。1件","details":{"entryEvaluation":"エントリー評価","exitEvaluation":"利確・損切り評価","trend":"トレンド","supportResistance":"サポート/レジスタンス","strategyConsistency":"手法との整合性"}}'}
      JSON以外の文章は出力しないでください。
      データや画像から確認できない事実を作らず、画像上で明確に確認できる内容に限って説明してください。改善点とnextActionは実行可能な具体策にしてください。1件だけの取引から一般的な傾向や将来の利益・勝率を断定せず、投資判断や売買推奨をしないでください。
      `, (value): value is {
        summary: string;
        goodPoints: string[];
        improvements: string[];
        nextAction: string;
        details: {
          entryEvaluation: string;
          exitEvaluation: string;
          trend: string;
          supportResistance: string;
          strategyConsistency: string;
          imageFindings?: string[];
          imageLimitations?: string[];
        };
      } => validateSingleAnalysisResult(value, chartImages.length > 0), chartImages);
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
