import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { calculatePips } from "../../shared/tradeMath.js";

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export type MT5Deal = {
  ticket: string;
  positionId: string;
  symbol: string;
  direction: "BUY" | "SELL";
  volume: number;
  entryPrice: number;
  exitPrice: number;
  entryTime: string;
  exitTime: string;
  profit: number;
  commission: number;
  swap: number;
  fee: number;
  accountCurrency: string;
  timeframe?: string;
};

export function normalizeDeal(value: unknown, userId: string, account: string) {
  if (!value || typeof value !== "object") throw new Error("取引データの形式が不正です。");
  const deal = value as Partial<MT5Deal>;
  const requiredStrings = [deal.ticket, deal.positionId, deal.symbol, deal.entryTime, deal.exitTime, deal.accountCurrency];
  if (requiredStrings.some((item) => typeof item !== "string" || !item.trim())) throw new Error("MT5の取引ID・銘柄・日時・通貨が不足しています。");
  if (deal.direction !== "BUY" && deal.direction !== "SELL") throw new Error("売買方向が不正です。");
  const numbers = [deal.volume, deal.entryPrice, deal.exitPrice, deal.profit, deal.commission, deal.swap, deal.fee];
  if (numbers.some((item) => typeof item !== "number" || !Number.isFinite(item)) || (deal.volume ?? 0) <= 0) throw new Error("価格・ロット・損益の値が不正です。");
  const entry = deal.entryPrice!;
  const exit = deal.exitPrice!;
  const netProfit = deal.profit! + deal.commission! + deal.swap! + deal.fee!;
  const duration = Math.max(0, (Date.parse(deal.exitTime!) - Date.parse(deal.entryTime!)) / 60_000);
  if (!Number.isFinite(Date.parse(deal.entryTime!)) || !Number.isFinite(Date.parse(deal.exitTime!))) throw new Error("日時形式が不正です。");
  return {
    id: randomUUID(),
    user_id: userId, symbol: deal.symbol!.trim(), direction: deal.direction, entry, exit,
    lot: deal.volume!, leverage: null, profit_currency: deal.accountCurrency!.trim().toUpperCase(), conversion_rate: 1,
    timeframe: deal.timeframe || "15分足", reason: "", take_profit: 0, stop_loss: 0, chart_image: "",
    entry_time: deal.entryTime, exit_time: deal.exitTime, profit: netProfit,
    pips: calculatePips(deal.symbol!, entry, exit), rr: 0, date: deal.exitTime!.slice(0, 10),
    holding_time: duration, result: netProfit > 0 ? "WIN" : netProfit < 0 ? "LOSS" : "DRAW",
    source: "mt5", mt5_account: account, mt5_deal_ticket: deal.ticket!.trim(), mt5_position_id: deal.positionId!.trim(),
    mt5_profit: deal.profit!, commission: deal.commission!, swap: deal.swap!, fee: deal.fee!,
  };
}

export async function saveMT5Deals(
  values: unknown[], userId: string, account: string,
  insertIgnoringDuplicates: (rows: ReturnType<typeof normalizeDeal>[]) => Promise<number>,
) {
  let skipped = 0;
  const prepared: ReturnType<typeof normalizeDeal>[] = [];
  for (const value of values) { try { prepared.push(normalizeDeal(value, userId, account)); } catch { skipped += 1; } }
  let imported = 0;
  for (let offset = 0; offset < prepared.length; offset += 250) imported += await insertIgnoringDuplicates(prepared.slice(offset, offset + 250));
  return { fetched: values.length, imported, existing: prepared.length - imported, skipped, errors: 0 };
}

function requireConfig() {
  if (!supabaseUrl || !serviceKey) throw new Error("MT5連携のサーバー設定がありません。SUPABASE_URLとSUPABASE_SERVICE_ROLE_KEYを設定してください。");
}

async function db(path: string, init: RequestInit = {}) {
  requireConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: serviceKey!, Authorization: `Bearer ${serviceKey!}`, "Content-Type": "application/json", ...init.headers },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`データベース処理に失敗しました (${response.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) as unknown : null;
}

export async function verifyUser(accessToken: string): Promise<string> {
  requireConfig();
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: serviceKey!, Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("ログイン状態を確認できません。再度ログインしてください。");
  const user = await response.json() as { id?: string };
  if (!user.id) throw new Error("ユーザー情報を確認できません。");
  return user.id;
}

export async function userAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "ログインが必要です。" });
    res.locals.userId = await verifyUser(token);
    next();
  } catch (error) { res.status(401).json({ error: error instanceof Error ? error.message : "認証に失敗しました。" }); }
}

async function mt5Token(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token || token.length > 300) return res.status(401).json({ error: "MT5連携キーが無効です。" });
    const hash = createHash("sha256").update(token).digest("hex");
    const rows = await db(`mt5_sync_tokens?token_hash=eq.${hash}&revoked_at=is.null&select=user_id`);
    const row = (rows as Array<{ user_id: string }>)[0];
    if (!row) return res.status(401).json({ error: "MT5連携キーが無効または失効しています。" });
    res.locals.userId = row.user_id;
    res.locals.tokenHash = hash;
    next();
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "認証に失敗しました。" }); }
}

export function registerMT5Routes(app: import("express").Express) {
  app.post("/api/mt5/link", userAuth, async (_req, res) => {
    try {
      const userId = res.locals.userId as string;
      await db(`mt5_sync_tokens?user_id=eq.${userId}&revoked_at=is.null`, { method: "PATCH", body: JSON.stringify({ revoked_at: new Date().toISOString() }) });
      const token = `fxj_${randomBytes(32).toString("base64url")}`;
      await db("mt5_sync_tokens", { method: "POST", body: JSON.stringify({ user_id: userId, token_hash: createHash("sha256").update(token).digest("hex") }), headers: { Prefer: "return=minimal" } });
      res.json({ token });
    } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "連携キーを発行できませんでした。" }); }
  });

  app.post("/api/mt5/sync-requests", userAuth, async (_req, res) => {
    try {
      const userId = res.locals.userId as string;
      const tokens = await db(`mt5_sync_tokens?user_id=eq.${userId}&revoked_at=is.null&select=id&limit=1`) as unknown[];
      if (!tokens.length) return res.status(400).json({ error: "先にMT5連携キーを発行してください。" });
      const active = await db(`mt5_sync_requests?user_id=eq.${userId}&status=in.(pending,processing)&select=id&limit=1`) as unknown[];
      if (active.length) return res.status(409).json({ error: "同期がすでに進行中です。少し待ってから確認してください。" });
      const rows = await db("mt5_sync_requests", { method: "POST", body: JSON.stringify({ user_id: userId, status: "pending" }), headers: { Prefer: "return=representation" } }) as Array<{ id: string }>;
      res.json({ requestId: rows[0].id });
    } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "同期を開始できませんでした。" }); }
  });

  app.get("/api/mt5/sync-requests/:id", userAuth, async (req, res) => {
    try {
      const requestId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const rows = await db(`mt5_sync_requests?id=eq.${encodeURIComponent(requestId)}&user_id=eq.${res.locals.userId}&select=id,status,summary,error,requested_at,finished_at`) as Array<Record<string, unknown>>;
      if (!rows.length) return res.status(404).json({ error: "同期状況が見つかりません。" });
      res.json(rows[0]);
    } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "同期状況を取得できませんでした。" }); }
  });

  app.get("/api/mt5/pending", mt5Token, async (_req, res) => {
    try {
      const userId = res.locals.userId as string;
      const rows = await db(`mt5_sync_requests?user_id=eq.${userId}&status=eq.pending&select=id&order=requested_at.asc&limit=1`) as Array<{ id: string }>;
      if (!rows.length) return res.json({ request: null });
      const claimed = await db(`mt5_sync_requests?id=eq.${rows[0].id}&status=eq.pending&select=id`, { method: "PATCH", body: JSON.stringify({ status: "processing", started_at: new Date().toISOString() }), headers: { Prefer: "return=representation" } }) as Array<{ id: string }>;
      res.json({ request: claimed.length ? { id: claimed[0].id } : null });
    } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "同期要求を取得できませんでした。" }); }
  });

  app.post("/api/mt5/sync-requests/:id/deals", mt5Token, async (req, res) => {
    const userId = res.locals.userId as string;
    const requestId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    try {
      const jobs = await db(`mt5_sync_requests?id=eq.${encodeURIComponent(requestId)}&user_id=eq.${userId}&status=eq.processing&select=id`) as unknown[];
      if (!jobs.length) return res.status(404).json({ error: "有効な同期要求がありません。" });
      const account = String(req.body?.account ?? "").trim();
      const deals = req.body?.deals;
      const clientSkipped = Number(req.body?.skipped ?? 0);
      if (!account || account.length > 100 || !Array.isArray(deals) || !Number.isInteger(clientSkipped) || clientSkipped < 0 || clientSkipped > 5000) {
        await db(`mt5_sync_requests?id=eq.${encodeURIComponent(requestId)}&user_id=eq.${userId}`, { method: "PATCH", body: JSON.stringify({ status: "failed", error: "口座IDまたは取引リストが不正です。", finished_at: new Date().toISOString() }), headers: { Prefer: "return=minimal" } });
        return res.status(400).json({ error: "口座IDまたは取引リストが不正です。" });
      }
      if (deals.length > 5000) {
        const message = "一度に同期できる決済取引は5,000件までです。期間を分けて同期してください。";
        await db(`mt5_sync_requests?id=eq.${encodeURIComponent(requestId)}&user_id=eq.${userId}`, { method: "PATCH", body: JSON.stringify({ status: "failed", error: message, finished_at: new Date().toISOString() }), headers: { Prefer: "return=minimal" } });
        return res.status(413).json({ error: message });
      }
      const summary = await saveMT5Deals(deals, userId, account, async (chunk) => {
        const inserted = await db("trades?on_conflict=user_id,mt5_account,mt5_deal_ticket", {
          method: "POST", body: JSON.stringify(chunk),
          headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
        }) as unknown[];
        return inserted.length;
      });
      summary.fetched += clientSkipped;
      summary.skipped += clientSkipped;
      await db(`mt5_sync_requests?id=eq.${encodeURIComponent(requestId)}&user_id=eq.${userId}`, { method: "PATCH", body: JSON.stringify({ status: "completed", summary, finished_at: new Date().toISOString() }), headers: { Prefer: "return=minimal" } });
      await db(`mt5_sync_tokens?user_id=eq.${userId}&revoked_at=is.null`, { method: "PATCH", body: JSON.stringify({ last_seen_at: new Date().toISOString() }), headers: { Prefer: "return=minimal" } });
      res.json(summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : "取引の保存に失敗しました。";
      try { await db(`mt5_sync_requests?id=eq.${encodeURIComponent(requestId)}&user_id=eq.${userId}`, { method: "PATCH", body: JSON.stringify({ status: "failed", error: message.slice(0, 500), finished_at: new Date().toISOString() }), headers: { Prefer: "return=minimal" } }); } catch { /* keep original error */ }
      res.status(500).json({ error: message });
    }
  });
}
