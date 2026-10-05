import { useEffect, useState } from "react";
import {
  analyzeTrades,
  analyzeWinRateByDirection,
  analyzeWinRateBySymbol,
  analyzeMethodPerformance,
  createAIAnalysisDataset,
  type Trade
} from "./tradeData";
import DashboardCard from "./components/DashboardCard";
import TradeCard from "./components/TradeCard";
import TradeForm from "./components/TradeForm";
import TradeDetail from "./components/TradeDetail";
import {
  loadTrades,
  insertTrade,
  updateTrade,
  deleteTrade
} from "./services/tradeService";
import AuthForm from "./components/authForm";
import MT5SyncPanel from "./components/MT5SyncPanel";
import { getCurrentSession, signOut } from "./services/authService";
import { supabase } from "./lib/supabaseClient";

type AIAnalysis = {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
};

type SingleAIAnalysis = {
  summary: string;
  goodPoints: string[];
  cautions: string[];
  improvements: string[];
};

type HomePage = "overview" | "analysis" | "trades";
const profitCurrencyOptions = ["JPY", "USD", "EUR", "GBP", "CHF", "AUD", "CAD", "NZD", "SGD", "HKD", "CNH", "MXN", "ZAR", "TRY", "PLN", "DKK", "HUF", "NOK", "SEK"];

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatProfitGroups(values: Record<string, number>) {
  const rows = Object.entries(values);
  return rows.length === 0 ? "—" : rows.map(([currency, value]) => formatMoney(value, currency)).join(" / ");
}

function formatSignedProfitGroups(values: Record<string, number>) {
  const rows = Object.entries(values);
  return rows.length === 0
    ? "—"
    : rows.map(([currency, value]) => `${value > 0 ? "+" : ""}${formatMoney(value, currency)}`).join(" / ");
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [homePage, setHomePage] = useState<HomePage>("overview");
  const [tradePage, setTradePage] = useState(0);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [singleAiAnalysis, setSingleAiAnalysis] = useState<SingleAIAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [tradeList, setTradeList] = useState<Trade[]>([]);
  const [displayCurrency, setDisplayCurrency] = useState("JPY");
  const [hiddenMethods, setHiddenMethods] = useState<string[]>([]);

  function restoreDisplayCurrency(id: string, profileCurrency?: unknown) {
    const savedCurrency = localStorage.getItem(`fx-journal-currency-${id}`);
    const currency = typeof profileCurrency === "string" ? profileCurrency : savedCurrency;
    setDisplayCurrency(profitCurrencyOptions.includes(currency ?? "") ? currency! : "JPY");
  }

  function handleDisplayCurrencyChange(currency: string) {
    setDisplayCurrency(currency);
    if (userId) {
      localStorage.setItem(`fx-journal-currency-${userId}`, currency);
      void supabase.auth.updateUser({ data: { profit_currency: currency } })
        .then(({ error }) => {
          if (error) console.error("損益通貨の保存に失敗しました:", error);
        })
        .catch((error: unknown) => console.error("損益通貨の保存に失敗しました:", error));
    }
  }

  function restoreHiddenMethods(id: string, profileMethods?: unknown) {
    let localMethods: unknown;
    try {
      localMethods = JSON.parse(localStorage.getItem(`fx-journal-hidden-methods-${id}`) ?? "[]");
    } catch {
      localMethods = [];
    }
    const savedMethods = Array.isArray(profileMethods)
      ? profileMethods
      : Array.isArray(localMethods) ? localMethods : [];
    setHiddenMethods(savedMethods.filter((method): method is string => typeof method === "string"));
  }

  function saveHiddenMethods(methods: string[]) {
    setHiddenMethods(methods);
    if (!userId) return;

    localStorage.setItem(`fx-journal-hidden-methods-${userId}`, JSON.stringify(methods));
    void supabase.auth.updateUser({ data: { hidden_methods: methods } })
      .then(({ error }) => {
        if (error) console.error("手法選択肢の保存に失敗しました:", error);
      })
      .catch((error: unknown) => console.error("手法選択肢の保存に失敗しました:", error));
  }

  function hideMethodOption(method: string) {
    saveHiddenMethods([...new Set([...hiddenMethods, method])]);
  }

  function restoreMethodOption(methods: string[]) {
    const restoredMethods = new Set(methods);
    saveHiddenMethods(hiddenMethods.filter((method) => !restoredMethods.has(method)));
  }

  const [tradeLoadError, setTradeLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;

    async function fetchTrades() {
      try {
        const savedTrades = await loadTrades();

        setTradeList(
          savedTrades.map((trade: Trade) => ({
            ...trade,
            methods: trade.methods ?? [],
          }))
        );
      } catch (error) {
        console.error("取引データの読み込みに失敗しました:", error);
        setTradeLoadError("取引データの読み込みに失敗しました。");
      }
    }

    fetchTrades();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const reloadTrades = () => { void loadTrades().then(setTradeList).catch((error: unknown) => console.error("同期後の取引再読み込みに失敗しました:", error)); };
    window.addEventListener("fx-journal-trades-updated", reloadTrades);
    return () => window.removeEventListener("fx-journal-trades-updated", reloadTrades);
  }, [userId]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setIsLoggedIn(true);
        setUserId(session.user.id);
        restoreDisplayCurrency(session.user.id, session.user.user_metadata?.profit_currency);
        restoreHiddenMethods(session.user.id, session.user.user_metadata?.hidden_methods);
      } else {
        setIsLoggedIn(false);
        setUserId(null);
        setTradeList([]);
        setHiddenMethods([]);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    async function checkSession() {
      const session = await getCurrentSession();

      if (session) {
        setIsLoggedIn(true);
        setUserId(session.user.id);
        restoreDisplayCurrency(session.user.id, session.user.user_metadata?.profit_currency);
        restoreHiddenMethods(session.user.id, session.user.user_metadata?.hidden_methods);
      }
    }

    checkSession();
  }, []);

  const [tradeSearch, setTradeSearch] = useState("");
  const [methodSearch, setMethodSearch] = useState("");
  const [directionFilter, setDirectionFilter] = useState<"ALL" | "BUY" | "SELL">("ALL");
  const [resultFilter, setResultFilter] = useState<"ALL" | "WIN" | "LOSS" | "DRAW">("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const analysis = analyzeTrades(tradeList);
  const directionAnalysis = analyzeWinRateByDirection(tradeList);
  const symbolAnalysis = analyzeWinRateBySymbol(tradeList);
  const methodPerformance = analyzeMethodPerformance(tradeList);
  const availableMethods = [...new Set([
    "水平線",
    "逆張り",
    "包み足",
    "ゴールデンクロス",
    ...tradeList.flatMap((trade) => trade.methods ?? []),
  ])].filter((method) => !hiddenMethods.includes(method));
  const filteredMethodPerformance = methodPerformance.filter((item) =>
    item.method.toLocaleLowerCase("ja").includes(methodSearch.trim().toLocaleLowerCase("ja"))
  );
  const filteredTrades = tradeList.filter((trade) => {
    const symbolMatch = trade.symbol.toLowerCase().includes(tradeSearch.toLowerCase());
    const directionMatch = directionFilter === "ALL" || trade.direction === directionFilter;
    const resultMatch = resultFilter === "ALL" || trade.result === resultFilter;
    const startMatch = startDate === "" || new Date(trade.entryTime) >= new Date(`${startDate}T00:00:00`);
    const endMatch = endDate === "" || new Date(trade.entryTime) <= new Date(`${endDate}T23:59:59`);

    return symbolMatch && directionMatch && resultMatch && startMatch && endMatch;
  });
  const tradesPerPage = 5;
  const totalTradePages = Math.ceil(filteredTrades.length / tradesPerPage);
  const currentTradePage = Math.min(tradePage, Math.max(totalTradePages - 1, 0));
  const visibleTrades = [...filteredTrades]
    .sort(
      (a, b) =>
        new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime()
    )
    .slice(currentTradePage * tradesPerPage, (currentTradePage + 1) * tradesPerPage);

  async function handleLogout() {
    const success = await signOut();

    if (!success) {
      alert("ログアウトに失敗しました。");
      return;
    }

    setIsLoggedIn(false);
    setUserId(null);
    setTradeList([]);
    setHiddenMethods([]);
    setSelectedTrade(null);
    setAiAnalysis(null);
    setSingleAiAnalysis(null);
  }

  async function testAIAnalysis() {
    if (tradeList.length === 0) {
      alert("取引データを追加してください");
      return;
    }

    setAiError(null);
    setIsAnalyzing(true);

    try {
      const response = await fetch(
        "http://localhost:3001/api/ai-analysis",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(createAIAnalysisDataset(tradeList)),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "AI分析に失敗しました");
      }

      setAiAnalysis(data.analysis);
    } catch (error) {
      console.error("AI分析エラー:", error);

      setAiError(
        error instanceof Error ? error.message : "AI分析に失敗しました"
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function analyzeSingleTrade(trade: Trade) {
    setAiError(null);
    setIsAnalyzing(true);

    try {
      const response = await fetch(
        "http://localhost:3001/api/ai-analysis-single",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            symbol: trade.symbol,
            direction: trade.direction,
            entry: trade.entry,
            exit: trade.exit,
            lot: trade.lot,
            leverage: trade.leverage ?? null,
            timeframe: trade.timeframe,
            reason: trade.reason,
            takeProfit: trade.takeProfit,
            stopLoss: trade.stopLoss,
            profit: trade.profit,
            profitCurrency: trade.profitCurrency ?? "JPY",
            pips: trade.pips,
            rr: trade.rr,
            result: trade.result,
            holdingTime: trade.holdingTime,
            entryTime: trade.entryTime,
            exitTime: trade.exitTime,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "AI分析に失敗しました");
      }

      setSingleAiAnalysis(data.analysis);

    } catch (error) {
      console.error("個別AI分析エラー:", error);

      setAiError(
        error instanceof Error
          ? error.message
          : "AI分析に失敗しました"
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleDeleteTrade(id: string) {
    const confirmed = window.confirm("この取引を削除してもよろしいですか？");

    if (!confirmed) {
      return;
    }

    const success = await deleteTrade(id);

    if (!success) {
      alert("取引データの削除に失敗しました。");
      return;
    }

    setTradeList((currentTrades) =>
      currentTrades.filter((trade) => trade.id !== id)
    );

    setSelectedTrade(null);
    setSingleAiAnalysis(null);
    setAiAnalysis(null);
    setAiError(null);
  }

  return (
    <div>
      {!isLoggedIn ? (
        <AuthForm onLogin={async () => {
          const session = await getCurrentSession();

          if (session) {
            setIsLoggedIn(true)
            setUserId(session.user.id);
            restoreDisplayCurrency(session.user.id, session.user.user_metadata?.profit_currency);
            restoreHiddenMethods(session.user.id, session.user.user_metadata?.hidden_methods);
          }
        }} />
      ) : (
        <>
          {selectedTrade ? (
            isEditing ? (
              <TradeForm
                userId={userId!}
                accountCurrency={displayCurrency}
                methodOptions={availableMethods}
                hiddenMethods={hiddenMethods}
                onRemoveMethodOption={hideMethodOption}
                onRestoreMethodOptions={restoreMethodOption}
                editTrade={selectedTrade}
                onBack={() => setIsEditing(false)}
                onAddTrade={async (newTrade) => {
                  const tradeToSave = selectedTrade.source === "mt5"
                    ? { ...selectedTrade, reason: newTrade.reason, methods: newTrade.methods }
                    : newTrade;
                  const success = await updateTrade(tradeToSave);

                  if (!success) {
                    alert("取引データの更新に失敗しました。");
                    return;
                  }

                  setTradeList((currentTrades) =>
                    currentTrades.map((trade) =>
                      trade.id === tradeToSave.id ? tradeToSave : trade)
                  );

                  setSelectedTrade(tradeToSave);
                  setIsEditing(false);
                  setAiAnalysis(null);
                  setAiError(null);
                }}
              />
            ) : (
              <TradeDetail
                trade={selectedTrade}
                onBack={() => setSelectedTrade(null)}
                onEdit={() => setIsEditing(true)}
                onDelete={handleDeleteTrade}
                onAnalyze={analyzeSingleTrade}
                singleAiAnalysis={singleAiAnalysis}
                isAnalyzing={isAnalyzing}
              />
            )
          ) : (
            <>
              <div className="app-header">
                <div>
                  <p className="app-subtitle">FX TRADING JOURNAL</p>
                  <h1>運用ノート</h1>
                </div>

                <div className="app-header-controls">
                  <label className="profit-currency-control">
                    <span>新規取引の損益通貨</span>
                    <select value={displayCurrency} onChange={(event) => handleDisplayCurrencyChange(event.target.value)}>
                      {profitCurrencyOptions.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                    </select>
                  </label>
                  <button className="logout-button" onClick={handleLogout}>ログアウト</button>
                </div>
              </div>

              {tradeLoadError && (
                <p className="ai-error">
                  ⚠️ {tradeLoadError}
                </p>
              )}

              {!showForm && (
                <nav className="home-navigation" aria-label="ホームメニュー">
                  {([
                    ["overview", "ホーム", "⌂"],
                    ["analysis", "分析", "▥"],
                    ["trades", "取引", "≡"],
                  ] as const).map(([page, label, icon]) => (
                    <button
                      key={page}
                      type="button"
                      className={homePage === page ? "active" : ""}
                      aria-current={homePage === page ? "page" : undefined}
                      onClick={() => setHomePage(page)}
                    >
                      <span className="home-navigation-icon" aria-hidden="true">{icon}</span>
                      <span>{label}</span>
                    </button>
                  ))}
                </nav>
              )}

              {!showForm && homePage === "overview" && (
                <section className="home-page overview-page" aria-label="ホーム概要">
              <div className="dashboard">
                <p className="dashboard-currency-note">
                  損益は記録時の通貨ごとに集計します。選択した通貨は新しい取引に適用されます。
                </p>
                <div className="dashboard-main">
                  <DashboardCard
                    title="総取引数"
                    value={analysis.totalTrades.toString()}
                  />

                  <DashboardCard
                    title="勝率"
                    value={`${analysis.winRate.toFixed(1)}%`}
                  />

                  <DashboardCard
                    title="総利益"
                    value={formatProfitGroups(analysis.profitByCurrency)}
                  />

                  <DashboardCard
                    title="平均利益"
                    value={formatProfitGroups(analysis.averageProfitByCurrency)}
                  />
                </div>

                <div className="dashboard-result">
                  <DashboardCard
                    title="勝ち"
                    value={analysis.winCount.toString()}
                    variant="win"
                  />

                  <DashboardCard
                    title="負け"
                    value={analysis.lossCount.toString()}
                    variant="loss"
                  />

                  <DashboardCard
                    title="引き分け"
                    value={analysis.drawCount.toString()}
                    variant="draw"
                  />
                </div>
              </div>

                  <div className="overview-actions">
                    <button type="button" onClick={() => setShowForm(true)}>
                      ＋ 取引を追加
                    </button>
                    <button type="button" onClick={() => setHomePage("trades")}>
                      取引履歴を見る
                    </button>
                  </div>
                </section>
              )}

              {!showForm && homePage === "analysis" && (
                <section className="home-page analysis-page" aria-label="取引分析">
              <h2>BUY / SELL別の勝率</h2>

              <div className="analysis-list">
                {directionAnalysis.map((item) => (
                  <div className="analysis-card" key={item.direction}>
                    <h3>{item.direction}</h3>
                    <p className="analysis-rate">
                      {item.winRate.toFixed(1)}%
                    </p>
                    <p>
                      {item.winCount}勝 / {item.totalTrades}取引
                    </p>
                  </div>
                ))}
              </div>

              <h2>通貨ペア別の勝率</h2>

              <div className="analysis-list">
                {symbolAnalysis.map((item) => (
                  <div className="analysis-card" key={item.symbol}>
                    <h3>{item.symbol}</h3>
                    <p className="analysis-rate">
                      {item.winRate.toFixed(1)}%
                    </p>
                    <p>
                      {item.winCount}勝 / {item.totalTrades}取引
                    </p>
                  </div>
                ))}
              </div>

              <h2>手法別の成績</h2>

              <div className="method-analysis-search">
                <label htmlFor="method-analysis-search">手法を検索</label>
                <input
                  id="method-analysis-search"
                  type="search"
                  value={methodSearch}
                  onChange={(event) => setMethodSearch(event.target.value)}
                  placeholder="手法名を入力"
                />
              </div>

              {filteredMethodPerformance.length === 0 ? (
                <p className="method-analysis-empty">
                  {methodPerformance.length === 0 ? "取引データがありません。" : "一致する手法がありません。"}
                </p>
              ) : (
                <div className="analysis-list method-analysis-list">
                  {filteredMethodPerformance.map((item) => (
                    <div className="analysis-card method-analysis-card" key={item.method}>
                      <h3>{item.method}</h3>
                      <p className="analysis-rate">{item.winRate.toFixed(1)}%</p>
                      <p className="method-analysis-rate-label">勝率</p>
                      <div className="method-analysis-counts">
                        <p><span>取引数</span><strong>{item.totalTrades}</strong></p>
                        <p><span>勝ち</span><strong>{item.winCount}</strong></p>
                        <p><span>負け</span><strong>{item.lossCount}</strong></p>
                        <p><span>引き分け</span><strong>{item.drawCount}</strong></p>
                      </div>
                      <div className="method-analysis-totals">
                        <p><span>総損益</span><strong>{formatSignedProfitGroups(item.profitByCurrency)}</strong></p>
                        <p><span>総pips</span><strong>{item.totalPips > 0 ? "+" : ""}{item.totalPips.toLocaleString("ja-JP", { maximumFractionDigits: 1 })} pips</strong></p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

                  <div className="analysis-actions">
                    <button onClick={testAIAnalysis} disabled={isAnalyzing}>
                      {isAnalyzing ? "AI分析中" : "AI分析を実行"}
                    </button>
                  </div>

                  {aiError && <p className="ai-error">⚠️ AI分析エラー: {aiError}</p>}

                  {aiAnalysis && (
                    <div className="ai-analysis">
                      <h2>🤖 AI分析</h2>
                      <div className="ai-section">
                        <h3>📊 全体分析</h3>
                        <p>{aiAnalysis.summary}</p>
                      </div>
                      <div className="ai-section">
                        <h3>💪 良かった特徴</h3>
                        <ul>{aiAnalysis.strengths.map((item, index) => <li key={index}>{item}</li>)}</ul>
                      </div>
                      <div className="ai-section">
                        <h3>⚠️ 注意点</h3>
                        <ul>{aiAnalysis.weaknesses.map((item, index) => <li key={index}>{item}</li>)}</ul>
                      </div>
                      <div className="ai-section">
                        <h3>💡 改善ポイント</h3>
                        <ul>{aiAnalysis.improvements.map((item, index) => <li key={index}>{item}</li>)}</ul>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {!showForm && homePage === "trades" && (
                <section className="home-page trades-page" aria-label="取引履歴">
                  <div className="trade-page-heading">
                    <div>
                      <p className="trade-search-subtitle">TRADE HISTORY</p>
                      <h2>取引履歴</h2>
                    </div>
                    <button type="button" onClick={() => setShowForm(true)}>＋ 取引を追加</button>
                  </div>

              <div className="trade-search">
                <MT5SyncPanel />
                <div className="trade-search-header">
                  <div>
                    <p className="trade-search-subtitle">TRADE HISTORY</p>
                    <h2>取引検索</h2>
                  </div>
                </div>

                <div className="trade-search-keyword">
                  <label>銘柄</label>

                  <div className="trade-search-input">
                    <span>⌕</span>

                    <input
                      type="text"
                      value={tradeSearch}
                      onChange={(e) => {
                        setTradeSearch(e.target.value);
                        setTradePage(0);
                      }}
                      placeholder="USDJPY、GOLDなど"
                    />
                  </div>
                </div>

                <div className="trade-search-filters">
                  <div className="trade-filter-group">
                    <label>方向</label>

                    <div className="filter-buttons">
                      <button
                        type="button"
                        className={directionFilter === "ALL" ? "active" : ""}
                        onClick={() => { setDirectionFilter("ALL"); setTradePage(0); }}
                      >
                        すべて
                      </button>

                      <button
                        type="button"
                        className={directionFilter === "BUY" ? "active buy" : ""}
                        onClick={() => { setDirectionFilter("BUY"); setTradePage(0); }}
                      >
                        BUY
                      </button>

                      <button
                        type="button"
                        className={directionFilter === "SELL" ? "active sell" : ""}
                        onClick={() => { setDirectionFilter("SELL"); setTradePage(0); }}
                      >
                        SELL
                      </button>
                    </div>
                  </div>

                  <div className="trade-filter-group">
                    <label>結果</label>

                    <div className="filter-buttons">
                      <button
                        type="button"
                        className={resultFilter === "ALL" ? "active" : ""}
                        onClick={() => { setResultFilter("ALL"); setTradePage(0); }}
                      >
                        すべて
                      </button>

                      <button
                        type="button"
                        className={resultFilter === "WIN" ? "active win" : ""}
                        onClick={() => { setResultFilter("WIN"); setTradePage(0); }}
                      >
                        WIN
                      </button>

                      <button
                        type="button"
                        className={resultFilter === "LOSS" ? "active loss" : ""}
                        onClick={() => { setResultFilter("LOSS"); setTradePage(0); }}
                      >
                        LOSS
                      </button>

                      <button
                        type="button"
                        className={resultFilter === "DRAW" ? "active draw" : ""}
                        onClick={() => { setResultFilter("DRAW"); setTradePage(0); }}
                      >
                        DRAW
                      </button>
                    </div>
                  </div>
                </div>

                <div className="trade-search-date">
                  <label>期間</label>

                  <div className="trade-date-inputs">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => { setStartDate(e.target.value); setTradePage(0); }}
                    />

                    <span>〜</span>

                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => { setEndDate(e.target.value); setTradePage(0); }}
                    />
                  </div>
                </div>

                <button type="button"
                  className="trade-search-reset"
                  onClick={() => {
                    setTradeSearch("");
                    setDirectionFilter("ALL");
                    setResultFilter("ALL");
                    setStartDate("");
                    setEndDate("");
                    setTradePage(0);
                  }}>
                  検索条件をリセット
                </button>

              </div>

              <div className="trade-list-header">
                <h2>最近の取引</h2>

                <span className="trade-result-count">
                  {filteredTrades.length}件
                </span>
              </div>

              {tradeList.length === 0 ? (
                <p>まだ取引がありません</p>
              ) : filteredTrades.length === 0 ? (
                <p>検索条件に一致する取引がありません</p>
              ) : (
                <ul className="trade-list">
                  {visibleTrades.map((trade) => (
                      <TradeCard
                        key={trade.id}
                        trade={trade}
                        onDelete={handleDeleteTrade}
                        onSelect={setSelectedTrade}
                      />
                    ))}
                </ul>
              )}
              {totalTradePages > 1 && (
                <div className="trade-pagination" aria-label="取引履歴ページ">
                  <button
                    type="button"
                    onClick={() => setTradePage((page) => Math.max(page - 1, 0))}
                    disabled={currentTradePage === 0}
                  >
                    前へ
                  </button>
                  <span>{currentTradePage + 1} / {totalTradePages}</span>
                  <button
                    type="button"
                    onClick={() => setTradePage((page) => Math.min(page + 1, totalTradePages - 1))}
                    disabled={currentTradePage >= totalTradePages - 1}
                  >
                    次へ
                  </button>
                </div>
              )}
                </section>
              )}

              {showForm && (
                <TradeForm
                  userId={userId!}
                  accountCurrency={displayCurrency}
                  methodOptions={availableMethods}
                  hiddenMethods={hiddenMethods}
                  onRemoveMethodOption={hideMethodOption}
                  onRestoreMethodOptions={restoreMethodOption}
                  onBack={() => setShowForm(false)}
                  onAddTrade={async (newTrade) => {
                    const success = await insertTrade(newTrade);
                    if (!success) {
                      alert("取引データの保存に失敗しました。");
                      return;
                    }

                    setTradeList((currentTrades) => [...currentTrades, newTrade]);
                    setAiAnalysis(null);
                    setAiError(null);
                  }}
                />
              )}

            </>
          )}
        </>
      )}
    </div>
  );
}

export default App;
