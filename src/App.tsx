import { useEffect, useRef, useState } from "react";
import {
  analyzeTrades,
  analyzeWinRateByDirection,
  analyzeWinRateBySymbol,
  analyzeMethodPerformance,
  getTradePriceMove,
  type Trade
} from "./tradeData";
import DashboardCard from "./components/DashboardCard";
import ProFeatureLock from "./components/ProFeatureLock";
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
import { getCurrentSession, signOut } from "./services/authService";
import { supabase } from "./lib/supabaseClient";
import CommunityPage from "./components/CommunityPage";
import NotificationsPage from "./components/NotificationsPage";
import { loadUnreadNotificationCount } from "./services/notificationService";
import { requestFullAIAnalysis, requestSingleAIAnalysis, type AIAnalysis, type AIUsageWindow, type SingleAIAnalysis } from "./services/aiService";
import { useSubscription } from "./hooks/useSubscription";

type HomePage = "overview" | "analysis" | "trades" | "community" | "notifications";
const profitCurrencyOptions = ["JPY", "USD", "EUR", "GBP", "CHF", "AUD", "CAD", "NZD", "SGD", "HKD", "CNH", "MXN", "ZAR", "TRY", "PLN", "DKK", "HUF", "NOK", "SEK"];

function AIUsagePeriod({ window }: { window: AIUsageWindow }) {
  const formatJst = (value: string) => new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));

  return <p className="ai-usage-period">
    利用期間（日本時間）：{formatJst(window.periodStart)} 〜 {formatJst(window.periodEnd)}
    <span> リセット：{formatJst(window.resetAt)}</span>
  </p>;
}

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
  const { subscription, error: subscriptionError } = useSubscription(userId);
  const isPro = subscription?.plan === "pro";
  const isSubscriptionLoading = userId !== null && subscription === null && subscriptionError === null;
  const [showForm, setShowForm] = useState(false);
  const [homePage, setHomePage] = useState<HomePage>("overview");
  const [tradePage, setTradePage] = useState(0);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [singleAiAnalysis, setSingleAiAnalysis] = useState<SingleAIAnalysis | null>(null);
  const [fullAIUsageWindow, setFullAIUsageWindow] = useState<AIUsageWindow | null>(null);
  const [singleAIUsageWindow, setSingleAIUsageWindow] = useState<AIUsageWindow | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [tradeList, setTradeList] = useState<Trade[]>([]);
  const [displayCurrency, setDisplayCurrency] = useState("JPY");
  const [hiddenMethods, setHiddenMethods] = useState<string[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [openCommunityPostId, setOpenCommunityPostId] = useState<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const tradeRequestGenerationRef = useRef(0);
  const aiRequestGenerationRef = useRef(0);

  function clearUserScopedState() {
    setTradeList([]);
    setSelectedTrade(null);
    setIsEditing(false);
    setShowForm(false);
    setAiAnalysis(null);
    setSingleAiAnalysis(null);
    setFullAIUsageWindow(null);
    setSingleAIUsageWindow(null);
    setIsAnalyzing(false);
    aiRequestGenerationRef.current += 1;
    setAiError(null);
    setTradeLoadError(null);
    setUnreadNotificationCount(0);
    setOpenCommunityPostId(null);
    setHomePage("overview");
  }

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

        if (isActive && requestGeneration === tradeRequestGenerationRef.current) {
          setTradeList(savedTrades.map((trade: Trade) => ({
            ...trade,
            methods: trade.methods ?? [],
          })));
        }
      } catch (error) {
        console.error("取引データの読み込みに失敗しました:", error);
        if (isActive && requestGeneration === tradeRequestGenerationRef.current) {
          setTradeLoadError("取引データの読み込みに失敗しました。");
        }
      }
    }

    let isActive = true;
    const requestGeneration = ++tradeRequestGenerationRef.current;
    fetchTrades();
    return () => {
      isActive = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    let isActive = true;
    loadUnreadNotificationCount(userId)
      .then((count) => {
        if (isActive) setUnreadNotificationCount(count);
      })
      .catch((error: unknown) => {
        console.error("未読通知数の取得に失敗しました:", error);
      });
    return () => {
      isActive = false;
    };
  }, [userId, homePage]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;
      if (currentUserIdRef.current !== nextUserId) {
        currentUserIdRef.current = nextUserId;
        tradeRequestGenerationRef.current += 1;
        clearUserScopedState();
      }

      if (session) {
        setIsLoggedIn(true);
        setUserId(session.user.id);
        restoreDisplayCurrency(session.user.id, session.user.user_metadata?.profit_currency);
        restoreHiddenMethods(session.user.id, session.user.user_metadata?.hidden_methods);
      } else {
        setIsLoggedIn(false);
        setUserId(null);
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
        if (currentUserIdRef.current !== session.user.id) {
          currentUserIdRef.current = session.user.id;
          tradeRequestGenerationRef.current += 1;
          clearUserScopedState();
        }
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
    currentUserIdRef.current = null;
    setUserId(null);
    setHiddenMethods([]);
    clearUserScopedState();
  }

  async function testAIAnalysis() {
    if (tradeList.length === 0) {
      alert("取引データを追加してください");
      return;
    }

    setAiError(null);
    setIsAnalyzing(true);
    const requestUserId = userId;
    const requestGeneration = ++aiRequestGenerationRef.current;

    try {
      const response = await requestFullAIAnalysis(tradeList);
      if (currentUserIdRef.current === requestUserId && requestGeneration === aiRequestGenerationRef.current) {
        setAiAnalysis(response.analysis);
        setFullAIUsageWindow(response.usage);
      }
    } catch (error) {
      console.error("AI分析エラー:", error);

      if (currentUserIdRef.current === requestUserId && requestGeneration === aiRequestGenerationRef.current) {
        setAiError(error instanceof Error ? error.message : "AI分析に失敗しました");
      }
    } finally {
      if (requestGeneration === aiRequestGenerationRef.current) setIsAnalyzing(false);
    }
  }

  async function analyzeSingleTrade(trade: Trade) {
    setAiError(null);
    setIsAnalyzing(true);
    const requestUserId = userId;
    const requestGeneration = ++aiRequestGenerationRef.current;
    const priceMove = getTradePriceMove(trade);

    try {
      const response = await requestSingleAIAnalysis(trade, priceMove.value, priceMove.unit);

      if (currentUserIdRef.current === requestUserId && requestGeneration === aiRequestGenerationRef.current) {
        setSingleAiAnalysis(response.analysis);
        setSingleAIUsageWindow(response.usage);
      }

    } catch (error) {
      console.error("個別AI分析エラー:", error);

      if (currentUserIdRef.current === requestUserId && requestGeneration === aiRequestGenerationRef.current) {
        setAiError(error instanceof Error ? error.message : "AI分析に失敗しました");
      }
    } finally {
      if (requestGeneration === aiRequestGenerationRef.current) setIsAnalyzing(false);
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
            if (currentUserIdRef.current !== session.user.id) {
              currentUserIdRef.current = session.user.id;
              tradeRequestGenerationRef.current += 1;
              clearUserScopedState();
            }
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
                  const success = await updateTrade(newTrade);

                  if (!success) {
                    alert("取引データの更新に失敗しました。");
                    return;
                  }

                  setTradeList((currentTrades) =>
                    currentTrades.map((trade) =>
                      trade.id === newTrade.id ? newTrade : trade)
                  );

                  setSelectedTrade(newTrade);
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
                aiUsageWindow={singleAIUsageWindow}
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
                  {subscription && (
                    <span className="subscription-plan-badge" aria-label={`現在のプラン: ${subscription.plan === "pro" ? "Pro" : "Free"}`}>
                      {subscription.plan === "pro" ? "Pro" : "Free"}
                    </span>
                  )}
                  <label className="profit-currency-control">
                    <span>新規取引の損益通貨</span>
                    <select value={displayCurrency} onChange={(event) => handleDisplayCurrencyChange(event.target.value)}>
                      {profitCurrencyOptions.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                    </select>
                  </label>
                  <button className="logout-button" onClick={handleLogout}>ログアウト</button>
                </div>
              </div>

              {subscriptionError && <p className="ai-error">{subscriptionError}</p>}

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
                    ["community", "コミュニティ", "◎"],
                    ["notifications", "通知", "♢"],
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
                      {page === "notifications" && unreadNotificationCount > 0 && (
                        <span className="notification-nav-badge" aria-label={`未読 ${unreadNotificationCount}件`}>
                          {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                        </span>
                      )}
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

                  <ProFeatureLock
                    title="平均利益"
                    isPro={isPro}
                    isLoading={isSubscriptionLoading}
                    compact
                  >
                    <DashboardCard
                      title="平均利益"
                      value={formatProfitGroups(analysis.averageProfitByCurrency)}
                    />
                  </ProFeatureLock>
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
                  <ProFeatureLock
                    title="BUY / SELL別の勝率"
                    isPro={isPro}
                    isLoading={isSubscriptionLoading}
                    labels={directionAnalysis.map((item) => item.direction)}
                  >
                    <div className="pro-feature-section">
                      <h2>BUY / SELL別の勝率</h2>
                      <div className="analysis-list">
                        {directionAnalysis.map((item) => (
                          <div className="analysis-card" key={item.direction}>
                            <h3>{item.direction}</h3>
                            <p className="analysis-rate">{item.winRate.toFixed(1)}%</p>
                            <p>{item.winCount}勝 / {item.totalTrades}取引</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </ProFeatureLock>

                  <ProFeatureLock
                    title="通貨ペア別の勝率"
                    isPro={isPro}
                    isLoading={isSubscriptionLoading}
                    labels={symbolAnalysis.map((item) => item.symbol)}
                  >
                    <div className="pro-feature-section">
                      <h2>通貨ペア別の勝率</h2>
                      <div className="analysis-list">
                        {symbolAnalysis.map((item) => (
                          <div className="analysis-card" key={item.symbol}>
                            <h3>{item.symbol}</h3>
                            <p className="analysis-rate">{item.winRate.toFixed(1)}%</p>
                            <p>{item.winCount}勝 / {item.totalTrades}取引</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </ProFeatureLock>

                  <ProFeatureLock
                    title="手法別の成績"
                    isPro={isPro}
                    isLoading={isSubscriptionLoading}
                    labels={methodPerformance.map((item) => item.method)}
                  >
                    <div className="pro-feature-section">
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
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </ProFeatureLock>

                  <div className="analysis-actions">
                    <button onClick={testAIAnalysis} disabled={isAnalyzing}>
                      {isAnalyzing ? "AI分析中" : "AI分析を実行"}
                    </button>
                  </div>

                  {aiError && <p className="ai-error">⚠️ AI分析エラー: {aiError}</p>}

                  {aiAnalysis && (
                    <div className="ai-analysis">
                      <h2>🤖 AI分析</h2>
                      {fullAIUsageWindow && <AIUsagePeriod window={fullAIUsageWindow} />}
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

              {!showForm && homePage === "community" && (
                <CommunityPage
                  key={userId ?? "anonymous"}
                  userId={userId}
                  openPostId={openCommunityPostId}
                  onOpenPostHandled={() => setOpenCommunityPostId(null)}
                />
              )}

              {!showForm && homePage === "notifications" && userId && (
                <NotificationsPage
                  key={userId}
                  userId={userId}
                  onNotificationRead={() => setUnreadNotificationCount((count) => Math.max(0, count - 1))}
                  onOpenPost={(postId) => {
                    setOpenCommunityPostId(postId);
                    setHomePage("community");
                  }}
                />
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
