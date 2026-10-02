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
  timeframe: Timeframe;
  reason: string;
  methods: string[];
  takeProfit: number;
  stopLoss: number;
  chartImage: string;
  entryTime: string;
  exitTime: string;
}

export interface Trade extends Omit<TradeInput, "leverage"> {
  leverage?: number | null;
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
  totalProfit: number;
  avgProfit: number;
}

export const trades: Trade[] = [];

export const symbols = [
  "USDJPY",
  "EURJPY",
  "GBPJPY",
  "AUDJPY",
  "NZDJPY",
  "CADJPY",
  "CHFJPY",
  "EURUSD",
  "GBPUSD",
  "AUDUSD",
  "NZDUSD",
  "USDCAD",
  "USDCHF",
  "EURGBP",
  "EURAUD",
  "EURNZD",
  "EURCAD",
  "EURCHF",
  "GBPAUD",
  "GBPNZD",
  "GBPCAD",
  "GBPCHF",
  "AUDNZD",
  "AUDCAD",
  "AUDCHF",
  "NZDCAD",
  "NZDCHF",
  "CADCHF",
  "GOLD",
  "NIKKEI",
];

export function getPipSize(symbol: string): number {
  const normalizedSymbol = symbol.trim().toUpperCase();

  if (normalizedSymbol === "GOLD") return 0.01;
  if (normalizedSymbol === "NIKKEI") return 1;
  if (/^[A-Z]{6}$/.test(normalizedSymbol)) {
    return normalizedSymbol.endsWith("JPY") ? 0.01 : 0.0001;
  }

  return 0.0001;
}

export function calculatePips(symbol: string, entry: number, exit: number): number {
  return Math.abs(exit - entry) / getPipSize(symbol);
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
    methods,
    takeProfit,
    stopLoss,
    chartImage,
    entryTime,
    exitTime,
  } = input;
  const priceDifference = direction === "BUY" ? exit - entry : entry - exit;
  const profit = priceDifference * lot * 100;
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
    entryTime,
    exitTime,
  };
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
    };
  }

  const winCount = trades.filter((trade) => trade.result === "WIN").length;
  const lossCount = trades.filter((trade) => trade.result === "LOSS").length;
  const drawCount = trades.filter((trade) => trade.result === "DRAW").length;

  const winRate = (winCount / totalTrades) * 100;
  const totalProfit = trades.reduce((acc, trade) => acc + trade.profit, 0);
  const avgProfit = totalProfit / totalTrades;

  return {
    totalTrades,
    winCount,
    lossCount,
    drawCount,
    winRate,
    totalProfit,
    avgProfit,
  };
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
    pips: trade.pips,
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

    trades: trades.map((trade) => ({
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
      pips: trade.pips,
      rr: trade.rr,
      result: trade.result,
      holdingTime: trade.holdingTime,
      entryTime: trade.entryTime,
      exitTime: trade.exitTime,
    })),
  };
}
