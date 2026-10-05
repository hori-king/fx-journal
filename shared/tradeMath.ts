import { findXMInstrument } from "./xmInstruments.js";

export type TradeDirection = "BUY" | "SELL";

export function getPipSize(symbol: string): number {
  if (symbol.trim().toUpperCase() === "NIKKEI") return 1;
  return findXMInstrument(symbol)?.pipSize ?? 0.0001;
}

export function calculatePips(symbol: string, entry: number, exit: number): number {
  return Math.abs(exit - entry) / getPipSize(symbol);
}

export function calculateProfit(
  symbol: string,
  direction: TradeDirection,
  entry: number,
  exit: number,
  lot: number,
  conversionRate: number,
): number {
  const instrument = findXMInstrument(symbol);
  const contractSize = instrument?.contractSize ?? (/^[A-Z]{6}$/.test(symbol) ? 100_000 : 1);
  const priceDifference = direction === "BUY" ? exit - entry : entry - exit;
  return priceDifference * lot * contractSize * conversionRate;
}
