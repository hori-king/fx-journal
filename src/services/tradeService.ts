import { calculatePips, getInstrumentProfitCurrency, getTradeChartImages, parseMethodsFromText, type Trade } from "../tradeData";
import { supabase } from "../lib/supabaseClient";

export async function loadTrades(): Promise<Trade[]> {
  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .order("entry_time", { ascending: false });

  if (error) {
    console.error("取引データの取得に失敗しました:", error);
    throw error;
  }

  return data.map(
    (trade): Trade => {
      const chartImages = deserializeChartImages(trade.chart_image);
      return ({
      id: trade.id,
      userId: trade.user_id,
      symbol: trade.symbol,
      direction: trade.direction as Trade["direction"],
      entry: trade.entry,
      exit: trade.exit,
      lot: trade.lot,
      leverage: trade.leverage ?? null,
      profitCurrency: trade.profit_currency ?? getInstrumentProfitCurrency(trade.symbol),
      conversionRate: trade.conversion_rate ?? null,
      timeframe: trade.timeframe as Trade["timeframe"],
      reason: trade.reason,
      methods: parseMethodsFromText(trade.reason ?? ""),
      takeProfit: trade.take_profit,
      stopLoss: trade.stop_loss,
      chartImage: chartImages[0] ?? "",
      chartImages,
      entryTime: trade.entry_time,
      exitTime: trade.exit_time,
      profit: trade.profit,
      pips: calculatePips(trade.symbol, trade.entry, trade.exit),
      rr: trade.rr,
      date: trade.date,
      holdingTime: trade.holding_time,
      result: trade.result as Trade["result"],
      });
    },
  );
}

export async function insertTrade(trade: Trade): Promise<boolean> {
  const { error } = await supabase.from("trades").insert({
    id: trade.id,
    user_id: trade.userId,
    symbol: trade.symbol,
    direction: trade.direction,
    entry: trade.entry,
    exit: trade.exit,
    lot: trade.lot,
    leverage: trade.leverage,
    profit_currency: trade.profitCurrency,
    conversion_rate: trade.conversionRate,
    timeframe: trade.timeframe,
    reason: trade.reason,
    take_profit: trade.takeProfit,
    stop_loss: trade.stopLoss,
    chart_image: serializeChartImages(trade),
    entry_time: trade.entryTime,
    exit_time: trade.exitTime,
    profit: trade.profit,
    pips: trade.pips,
    rr: trade.rr,
    date: trade.date,
    holding_time: trade.holdingTime,
    result: trade.result,
  });

  if (error) {
    console.error("取引データの挿入に失敗しました:", error);
    return false;
  }

  return true;
}

export async function updateTrade(trade: Trade): Promise<boolean> {
  const { error } = await supabase
    .from("trades")
    .update({
      symbol: trade.symbol,
      direction: trade.direction,
      entry: trade.entry,
      exit: trade.exit,
      lot: trade.lot,
      leverage: trade.leverage,
      profit_currency: trade.profitCurrency,
      conversion_rate: trade.conversionRate,
      timeframe: trade.timeframe,
      reason: trade.reason,
      take_profit: trade.takeProfit,
      stop_loss: trade.stopLoss,
      chart_image: serializeChartImages(trade),
      entry_time: trade.entryTime,
      exit_time: trade.exitTime,
      profit: trade.profit,
      pips: trade.pips,
      rr: trade.rr,
      date: trade.date,
      holding_time: trade.holdingTime,
      result: trade.result,
    })
    .eq("id", trade.id);

  if (error) {
    console.error("取引データの更新に失敗しました:", error);
    return false;
  }

  return true;
}

function serializeChartImages(trade: Trade): string {
  const images = getTradeChartImages(trade);
  if (images.length > 1) return JSON.stringify(images);
  return images[0] ?? "";
}

function deserializeChartImages(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  if (value.trimStart().startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((image) => typeof image === "string")) return parsed;
    } catch {
      // 古い単一画像データはそのまま扱う。
    }
  }
  return [value];
}

export async function deleteTrade(id: string): Promise<boolean> {
  const { error } = await supabase.from("trades").delete().eq("id", id);

  if (error) {
    console.error("取引データの削除に失敗しました:", error);
    return false;
  }

  return true;
}
