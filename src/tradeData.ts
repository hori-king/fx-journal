import { findXMInstrument, xmSymbols } from "./xmInstruments";

export { findXMInstrument, searchXMInstruments, xmInstruments } from "./xmInstruments";

export type Direction = "BUY" | "SELL";
export type Result = "WIN" | "LOSS" | "DRAW";
export type Timeframe =
  | "1分足"
  | "5分足"
  | "15分足"
  | "30分足"
  | "1時間足"
  | "4時間足"
  | "日足"
  | "週足"
  | "月足";

export interface TradeInput {
  userId: string;
  symbol: string;
  direction: Direction;
  entry: number;
  exit: number;
  lot: number;
  leverage: number;
  profitCurrency: string;
  conversionRate: number;
  timeframe: Timeframe;
  reason: string;
  methods: string[];
  takeProfit: number;
  stopLoss: number;
  chartImage: string;
  chartImages?: string[];
  entryTime: string;
  exitTime: string;
}

export interface Trade extends Omit<TradeInput, "leverage" | "profitCurrency" | "conversionRate"> {
  leverage?: number | null;
  profitCurrency?: string;
  conversionRate?: number | null;
  id: string;
  profit: number;
  pips: number;
  rr: number;
  date: string;
  holdingTime: number;
  result: Result;
}

export interface AnalyzeResult {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  drawCount: number;
  winRate: number;
  totalProfit: number | null;
  avgProfit: number | null;
  profitByCurrency: Record<string, number>;
  averageProfitByCurrency: Record<string, number>;
}

export interface MethodAnalysis extends AnalyzeResult {
  method: string;
}

export type MoveUnit = "pips" | "points";

export interface TradePriceMove {
  value: number;
  unit: MoveUnit;
}

export const trades: Trade[] = [];

export const symbols = [...xmSymbols, "NIKKEI"];

export function getPipSize(symbol: string): number {
  if (symbol.trim().toUpperCase() === "NIKKEI") return 1;
  return findXMInstrument(symbol)?.pipSize ?? 0.0001;
}

export function calculatePips(symbol: string, entry: number, exit: number): number {
  return Math.abs(exit - entry) / getPipSize(symbol);
}

export function getMoveUnit(symbol: string): MoveUnit {
  return findXMInstrument(symbol)?.moveUnit ?? "pips";
}

export function getTradePriceMove(trade: Pick<Trade, "symbol" | "direction" | "entry" | "exit">): TradePriceMove {
  const priceDifference = trade.direction === "BUY" ? trade.exit - trade.entry : trade.entry - trade.exit;
  return { value: priceDifference / getPipSize(trade.symbol), unit: getMoveUnit(trade.symbol) };
}

export function formatTradePriceMove(trade: Pick<Trade, "symbol" | "direction" | "entry" | "exit">): string {
  const { value } = getTradePriceMove(trade);
  const rounded = Math.abs(value) < 0.05 ? 0 : Number(value.toFixed(1));
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}`;
}

export function parseMethodsFromText(text: string): string[] {
  return [...new Set(
    text
      .split(/[＋+、,，・;；|｜/／\n\r]+/)
      .map((method) => method.trim())
      .filter(Boolean),
  )];
}

export function getInstrumentProfitCurrency(symbol: string): string {
  if (symbol.trim().toUpperCase() === "NIKKEI") return "JPY";
  const instrument = findXMInstrument(symbol);
  if (instrument) return instrument.profitCurrency;
  if (/^[A-Z]{6}$/.test(symbol)) return symbol.slice(3).toUpperCase();
  return "USD";
}

export function calculateProfit(
  symbol: string,
  direction: Direction,
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

export function createTrade(input: TradeInput): Trade {
  const {
    symbol,
    direction,
    entry,
    exit,
    lot,
    timeframe,
    reason,
    takeProfit,
    stopLoss,
    chartImage,
    entryTime,
    exitTime,
  } = input;
  const selectedMethods = parseMethodsFromText(input.methods.join("＋"));
  const methods = selectedMethods.length > 0 ? selectedMethods : parseMethodsFromText(reason);
  const profit = calculateProfit(
    symbol,
    direction,
    entry,
    exit,
    lot,
    input.conversionRate,
  );
  const pips = calculatePips(symbol, entry, exit);
  const rr = calcRR(entry, takeProfit, stopLoss, direction);
  const result = getResult(profit);
  const date = new Date().toDateString();
  const holdingTime =
    (new Date(exitTime).getTime() - new Date(entryTime).getTime()) / 60000;

  return {
    id: crypto.randomUUID(),
    ...input,
    symbol,
    direction,
    entry,
    exit,
    lot,
    profit,
    timeframe,
    reason,
    methods,
    pips,
    rr,
    date,
    takeProfit,
    stopLoss,
    holdingTime,
    result,
    chartImage,
    chartImages: input.chartImages?.length ? input.chartImages : chartImage ? [chartImage] : [],
    entryTime,
    exitTime,
  };
}

export function getTradeChartImages(trade: Pick<Trade, "chartImage" | "chartImages">): string[] {
  if (trade.chartImages?.length) return trade.chartImages;
  return trade.chartImage ? [trade.chartImage] : [];
}

export function addTrade(input: TradeInput): Trade {
  return createTrade(input);
}

export function analyzeTrades(trades: Trade[]): AnalyzeResult {
  const totalTrades = trades.length;

  if (totalTrades === 0) {
    return {
      totalTrades: 0,
      winCount: 0,
      lossCount: 0,
      drawCount: 0,
      winRate: 0,
      totalProfit: 0,
      avgProfit: 0,
      profitByCurrency: {},
      averageProfitByCurrency: {},
    };
  }

  const winCount = trades.filter((trade) => trade.result === "WIN").length;
  const lossCount = trades.filter((trade) => trade.result === "LOSS").length;
  const drawCount = trades.filter((trade) => trade.result === "DRAW").length;

  const winRate = (winCount / totalTrades) * 100;
  const profitByCurrency = trades.reduce<Record<string, number>>((totals, trade) => {
    const currency = trade.profitCurrency ?? getInstrumentProfitCurrency(trade.symbol);
    totals[currency] = (totals[currency] ?? 0) + trade.profit;
    return totals;
  }, {});
  const profitCountsByCurrency = trades.reduce<Record<string, { total: number; count: number }>>((totals, trade) => {
    const currency = trade.profitCurrency ?? getInstrumentProfitCurrency(trade.symbol);
    const current = totals[currency] ?? { total: 0, count: 0 };
    totals[currency] = { total: current.total + trade.profit, count: current.count + 1 };
    return totals;
  }, {});
  const profitCurrencyValues = Object.values(profitByCurrency);
  const profitCountValues = Object.values(profitCountsByCurrency);
  const totalProfit = profitCurrencyValues.length === 1 ? profitCurrencyValues[0] : null;
  const avgProfit = profitCountValues.length === 1
    ? profitCountValues[0].total / profitCountValues[0].count
    : null;

  return {
    totalTrades,
    winCount,
    lossCount,
    drawCount,
    winRate,
    totalProfit,
    avgProfit,
    profitByCurrency,
    averageProfitByCurrency: Object.fromEntries(
      Object.entries(profitCountsByCurrency).map(([currency, value]) => [currency, value.total / value.count])
    ),
  };
}

export function analyzeMethodPerformance(trades: Trade[]): MethodAnalysis[] {
  const tradesByMethod = new Map<string, Trade[]>();

  for (const trade of trades) {
    const methods = [...new Set(trade.methods.map((method) => method.trim()).filter(Boolean))];
    const tradeMethods = methods.length > 0 ? methods : ["手法未設定"];

    for (const method of tradeMethods) {
      const methodTrades = tradesByMethod.get(method) ?? [];
      methodTrades.push(trade);
      tradesByMethod.set(method, methodTrades);
    }
  }

  return [...tradesByMethod.entries()]
    .map(([method, methodTrades]) => ({
      method,
      ...analyzeTrades(methodTrades),
    }))
    .sort((a, b) => b.totalTrades - a.totalTrades || a.method.localeCompare(b.method, "ja"));
}

function getResult(profit: number): Result {
  if (profit > 0) {
    return "WIN";
  }
  if (profit < 0) {
    return "LOSS";
  }
  return "DRAW";
}

function calcRR(
  entry: number,
  takeProfit: number,
  stopLoss: number,
  direction: Direction,
): number {
  const reward = direction === "BUY" ? takeProfit - entry : entry - takeProfit;
  const risk = direction === "BUY" ? entry - stopLoss : stopLoss - entry;

  return reward / risk;
}

export function analyzeWinRateByDirection(trades: Trade[]) {
  const directions: Direction[] = ["BUY", "SELL"];

  return directions.map((direction) => {
    const directionTrades = trades.filter(
      (trade) => trade.direction === direction,
    );

    const winCount = directionTrades.filter(
      (trade) => trade.result === "WIN",
    ).length;

    const winRate =
      directionTrades.length === 0
        ? 0
        : (winCount / directionTrades.length) * 100;

    return {
      direction,
      totalTrades: directionTrades.length,
      winCount,
      winRate,
    };
  });
}

export function analyzeWinRateBySymbol(trades: Trade[]) {
  const uniqueSymbols = [...new Set(trades.map((trade) => trade.symbol))];

  return uniqueSymbols.map((symbol) => {
    const symbolTrades = trades.filter((trade) => trade.symbol === symbol);

    const winCount = symbolTrades.filter(
      (trade) => trade.result === "WIN",
    ).length;

    const winRate =
      symbolTrades.length === 0 ? 0 : (winCount / symbolTrades.length) * 100;

    return {
      symbol,
      totalTrades: symbolTrades.length,
      winCount,
      winRate,
    };
  });
}

export function analyzeWinRateByMethod(trades: Trade[]) {
  const uniqueMethods = [...new Set(trades.flatMap((trade) => trade.methods))];

  return uniqueMethods.map((method) => {
    const methodTrades = trades.filter((trade) =>
      trade.methods.includes(method),
    );

    const winCount = methodTrades.filter(
      (trade) => trade.result === "WIN",
    ).length;

    const winRate =
      methodTrades.length === 0 ? 0 : (winCount / methodTrades.length) * 100;

    return {
      method,
      totalTrades: methodTrades.length,
      winCount,
      winRate,
    };
  });
}

export function createAIAnalysisData(trade: Trade) {
  const priceMove = getTradePriceMove(trade);
  return {
    symbol: trade.symbol,
    direction: trade.direction,
    timeframe: trade.timeframe,
    entry: trade.entry,
    exit: trade.exit,
    takeProfit: trade.takeProfit,
    stopLoss: trade.stopLoss,
    lot: trade.lot,
    leverage: trade.leverage ?? null,
    profit: trade.profit,
    profitCurrency: trade.profitCurrency ?? getInstrumentProfitCurrency(trade.symbol),
    priceMove: priceMove.value,
    priceMoveUnit: priceMove.unit,
    rr: trade.rr,
    result: trade.result,
    reason: trade.reason,
    chartImage: trade.chartImage,
  };
}

export function createAIAnalysisDataset(trades: Trade[]) {
  const analysis = analyzeTrades(trades);
  const directionAnalysis = analyzeWinRateByDirection(trades);
  const symbolAnalysis = analyzeWinRateBySymbol(trades);
  const methodAnalysis = analyzeWinRateByMethod(trades);

  return {
    summary: analysis,

    directionAnalysis,

    symbolAnalysis,

    methodAnalysis,

    trades: trades.map((trade) => {
      const priceMove = getTradePriceMove(trade);
      return ({
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
      profitCurrency: trade.profitCurrency ?? getInstrumentProfitCurrency(trade.symbol),
      priceMove: priceMove.value,
      priceMoveUnit: priceMove.unit,
      rr: trade.rr,
      result: trade.result,
      holdingTime: trade.holdingTime,
      entryTime: trade.entryTime,
      exitTime: trade.exitTime,
      });
    }),
  };
}
