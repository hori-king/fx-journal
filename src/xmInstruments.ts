export interface XMInstrument {
  symbol: string;
  name: string;
  category: string;
  pipSize: number;
  contractSize: number;
  profitCurrency: string;
  moveUnit?: "pips" | "points";
  aliases?: string[];
}

const fxPairs = [
  "AUDCAD", "AUDCHF", "AUDJPY", "AUDNZD", "AUDUSD", "CADCHF", "CADJPY", "CHFJPY",
  "EURAUD", "EURCAD", "EURCHF", "EURGBP", "EURJPY", "EURNZD", "EURUSD", "GBPAUD",
  "GBPCAD", "GBPCHF", "GBPJPY", "GBPNZD", "GBPUSD", "NZDCAD", "NZDCHF", "NZDJPY",
  "NZDSGD", "NZDUSD", "USDCAD", "USDCHF", "USDCNH", "USDDKK", "USDHKD", "USDHUF",
  "USDJPY", "USDMXN", "USDNOK", "USDPLN", "USDRUB", "USDSEK", "USDSGD", "USDTRY",
  "USDZAR", "EURDKK", "EURHUF", "EURNOK", "EURPLN", "EURSEK", "EURTRY", "EURZAR",
  "GBPDKK", "GBPNOK", "GBPSEK", "GBPSGD", "GBPZAR", "CHFSGD", "EURSGD", "SGDJPY",
];

const fxInstruments: XMInstrument[] = fxPairs.map((symbol) => ({
  symbol,
  name: `${symbol.slice(0, 3)} / ${symbol.slice(3)}`,
  category: "FX通貨ペア",
  pipSize: symbol.endsWith("JPY") ? 0.01 : 0.0001,
  contractSize: 100_000,
  profitCurrency: symbol.slice(3),
  moveUnit: "pips",
}));

const indexSpecs: Array<[string, string, string, string[]?]> = [
  ["US100Cash", "NASDAQ 100 現物", "USD", ["NASDAQ", "ナスダック", "NAS100"]],
  ["US100", "NASDAQ 100 先物", "USD", ["NASDAQ", "ナスダック", "NAS100"]],
  ["US30Cash", "US Dow Jones 30 現物", "USD", ["ダウ"]],
  ["US30", "US Dow Jones 30 先物", "USD", ["ダウ"]],
  ["US500Cash", "US S&P 500 現物", "USD", ["S&P500"]],
  ["US500", "US S&P 500 先物", "USD", ["S&P500"]],
  ["US2000Cash", "US Russell 2000 現物", "USD", ["ラッセル"]],
  ["JP225Cash", "日経225 現物", "JPY", ["NIKKEI", "日経"]],
  ["JP225", "日経225 先物", "JPY", ["NIKKEI", "日経"]],
  ["GER40Cash", "ドイツ40 現物", "EUR", ["DAX"]],
  ["GER40", "ドイツ40 先物", "EUR", ["DAX"]],
  ["UK100Cash", "英国100 現物", "GBP", ["FTSE"]],
  ["UK100", "英国100 先物", "GBP", ["FTSE"]],
  ["AUS200Cash", "オーストラリア200 現物", "AUD"],
  ["AUS200", "オーストラリア200 先物", "AUD"],
  ["EU50Cash", "欧州50 現物", "EUR", ["EURO STOXX"]],
  ["EU50", "欧州50 先物", "EUR", ["EURO STOXX"]],
  ["FRA40Cash", "フランス40 現物", "EUR", ["CAC"]],
  ["FRA40", "フランス40 先物", "EUR", ["CAC"]],
  ["HK50Cash", "香港ハンセン 現物", "HKD", ["HANG SENG"]],
  ["HK50", "香港ハンセン 先物", "HKD", ["HANG SENG"]],
  ["IT40Cash", "イタリア40 現物", "EUR"], ["IT40", "イタリア40 先物", "EUR"],
  ["NETH25Cash", "オランダ25 現物", "EUR"], ["NETH25", "オランダ25 先物", "EUR"],
  ["SPAIN35Cash", "スペイン35 現物", "EUR"], ["SPAIN35", "スペイン35 先物", "EUR"],
  ["SWI20Cash", "スイス20 現物", "CHF"], ["SWI20", "スイス20 先物", "CHF"],
  ["ChinaHCash", "中国香港H株 現物", "HKD"], ["ChinaH", "中国香港H株 先物", "HKD"],
];

const indexInstruments: XMInstrument[] = indexSpecs.map(([symbol, name, currency, aliases]) => ({
  symbol,
  name,
  category: "株価指数CFD",
  pipSize: 1,
  contractSize: 1,
  profitCurrency: currency,
  moveUnit: "points",
  aliases,
}));

const otherInstruments: XMInstrument[] = [
  { symbol: "GOLD", name: "ゴールド / 米ドル", category: "貴金属", pipSize: 0.1, contractSize: 100, profitCurrency: "USD", moveUnit: "pips", aliases: ["XAUUSD", "金"] },
  { symbol: "GOLD24-7", name: "ゴールド24-7", category: "貴金属", pipSize: 0.1, contractSize: 100, profitCurrency: "USD", moveUnit: "pips", aliases: ["金"] },
  { symbol: "XAUEUR", name: "ゴールド / ユーロ", category: "貴金属", pipSize: 0.01, contractSize: 100, profitCurrency: "EUR", aliases: ["金"] },
  { symbol: "XAUJPY", name: "ゴールド / 日本円", category: "貴金属", pipSize: 1, contractSize: 100, profitCurrency: "JPY", aliases: ["金"] },
  { symbol: "XAUCNH", name: "ゴールド / 人民元", category: "貴金属", pipSize: 0.01, contractSize: 100, profitCurrency: "CNH", aliases: ["金"] },
  { symbol: "SILVER", name: "シルバー / 米ドル", category: "貴金属", pipSize: 0.001, contractSize: 5_000, profitCurrency: "USD", aliases: ["XAGUSD", "銀"] },
  { symbol: "PALL", name: "パラジウム", category: "貴金属", pipSize: 0.01, contractSize: 10, profitCurrency: "USD" },
  { symbol: "PLAT", name: "プラチナ", category: "貴金属", pipSize: 0.01, contractSize: 10, profitCurrency: "USD" },
  { symbol: "OIL", name: "WTI原油 現物", category: "エネルギー", pipSize: 0.01, contractSize: 100, profitCurrency: "USD", aliases: ["USOIL"] },
  { symbol: "OILMn", name: "WTI原油 ミニ", category: "エネルギー", pipSize: 0.01, contractSize: 10, profitCurrency: "USD", aliases: ["USOIL"] },
  { symbol: "OILCash", name: "WTI原油 現物", category: "エネルギー", pipSize: 0.01, contractSize: 100, profitCurrency: "USD", aliases: ["USOIL"] },
  { symbol: "BRENT", name: "ブレント原油", category: "エネルギー", pipSize: 0.01, contractSize: 100, profitCurrency: "USD" },
  { symbol: "NGAS", name: "天然ガス", category: "エネルギー", pipSize: 0.001, contractSize: 1_000, profitCurrency: "USD" },
  { symbol: "COCOA", name: "米国ココア", category: "コモディティ", pipSize: 1, contractSize: 1, profitCurrency: "USD" },
  { symbol: "COFFE", name: "米国コーヒー", category: "コモディティ", pipSize: 0.01, contractSize: 10_000, profitCurrency: "USD" },
  { symbol: "CORN", name: "米国コーン", category: "コモディティ", pipSize: 0.01, contractSize: 400, profitCurrency: "USD" },
  { symbol: "COTTO", name: "米国コットン", category: "コモディティ", pipSize: 0.01, contractSize: 10_000, profitCurrency: "USD" },
  { symbol: "HGCOP", name: "銅", category: "コモディティ", pipSize: 0.0001, contractSize: 2_000, profitCurrency: "USD" },
  { symbol: "SBEAN", name: "米国大豆", category: "コモディティ", pipSize: 0.01, contractSize: 400, profitCurrency: "USD" },
  { symbol: "SUGAR", name: "米国砂糖", category: "コモディティ", pipSize: 0.0001, contractSize: 10_000, profitCurrency: "USD" },
  { symbol: "WHEAT", name: "米国小麦", category: "コモディティ", pipSize: 0.01, contractSize: 400, profitCurrency: "USD" },
  { symbol: "BTCUSD", name: "ビットコイン / 米ドル", category: "暗号資産CFD", pipSize: 1, contractSize: 1, profitCurrency: "USD", aliases: ["ビットコイン"] },
  { symbol: "ETHUSD", name: "イーサリアム / 米ドル", category: "暗号資産CFD", pipSize: 0.01, contractSize: 1, profitCurrency: "USD", aliases: ["イーサリアム"] },
];

// 取扱銘柄の追加・条件更新は、このカタログを基準に行う。
export const xmInstruments: XMInstrument[] = [
  ...fxInstruments,
  ...indexInstruments,
  ...otherInstruments,
];

export const xmSymbols = xmInstruments.map((instrument) => instrument.symbol);

export function findXMInstrument(symbol: string): XMInstrument | undefined {
  const normalized = symbol.trim().toUpperCase();
  return xmInstruments.find((instrument) => instrument.symbol.toUpperCase() === normalized)
    ?? xmInstruments.find((instrument) => instrument.aliases?.some((alias) => alias.toUpperCase() === normalized));
}

export function searchXMInstruments(query: string): XMInstrument[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return xmInstruments;

  return xmInstruments.filter((instrument) =>
    [instrument.symbol, instrument.name, instrument.category, ...(instrument.aliases ?? [])]
      .some((value) => value.toLowerCase().includes(normalized))
  );
}
