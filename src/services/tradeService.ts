import type { Trade } from "../tradeData";
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
    (trade): Trade => ({
      id: trade.id,
      userId: trade.user_id,
      symbol: trade.symbol,
      direction: trade.direction as Trade["direction"],
      entry: trade.entry,
      exit: trade.exit,
      lot: trade.lot,
      timeframe: trade.timeframe as Trade["timeframe"],
      reason: trade.reason,
      methods: [],
      takeProfit: trade.take_profit,
      stopLoss: trade.stop_loss,
      chartImage: trade.chart_image,
      entryTime: trade.entry_time,
      exitTime: trade.exit_time,
      profit: trade.profit,
      pips: trade.pips,
      rr: trade.rr,
      date: trade.date,
      holdingTime: trade.holding_time,
      result: trade.result as Trade["result"],
    }),
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
    timeframe: trade.timeframe,
    reason: trade.reason,
    take_profit: trade.takeProfit,
    stop_loss: trade.stopLoss,
    chart_image: trade.chartImage,
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
      timeframe: trade.timeframe,
      reason: trade.reason,
      take_profit: trade.takeProfit,
      stop_loss: trade.stopLoss,
      chart_image: trade.chartImage,
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

export async function deleteTrade(id: string): Promise<boolean> {
  const { error } = await supabase.from("trades").delete().eq("id", id);

  if (error) {
    console.error("取引データの削除に失敗しました:", error);
    return false;
  }

  return true;
}
