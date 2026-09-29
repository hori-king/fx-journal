import { useEffect, useState } from "react";
import './App.css';
import {
  analyzeTrades,
  analyzeWinRateByDirection,
  analyzeWinRateBySymbol,
  analyzeWinRateByMethod,
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

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [singleAiAnalysis, setSingleAiAnalysis] = useState<SingleAIAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [tradeList, setTradeList] = useState<Trade[]>([]);

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
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setIsLoggedIn(true);
        setUserId(session.user.id);
      } else {
        setIsLoggedIn(false);
        setUserId(null);
        setTradeList([]);
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
      }
    }

    checkSession();
  }, []);

  const [tradeSearch, setTradeSearch] = useState("");
  const [directionFilter, setDirectionFilter] = useState<"ALL" | "BUY" | "SELL">("ALL");
  const [resultFilter, setResultFilter] = useState<"ALL" | "WIN" | "LOSS" | "DRAW">("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const analysis = analyzeTrades(tradeList);
  const directionAnalysis = analyzeWinRateByDirection(tradeList);
  const symbolAnalysis = analyzeWinRateBySymbol(tradeList);
  const methodAnalysis = analyzeWinRateByMethod(tradeList);
  const filteredTrades = tradeList.filter((trade) => {
    const symbolMatch = trade.symbol.toLowerCase().includes(tradeSearch.toLowerCase());
    const directionMatch = directionFilter === "ALL" || trade.direction === directionFilter;
    const resultMatch = resultFilter === "ALL" || trade.result === resultFilter;
    const startMatch = startDate === "" || new Date(trade.entryTime) >= new Date(`${startDate}T00:00:00`);
    const endMatch = endDate === "" || new Date(trade.entryTime) <= new Date(`${endDate}T23:59:59`);

    return symbolMatch && directionMatch && resultMatch && startMatch && endMatch;
  });

  async function handleLogout() {
    const success = await signOut();

    if (!success) {
      alert("ログアウトに失敗しました。");
      return;
    }

    setIsLoggedIn(false);
    setUserId(null);
    setTradeList([]);
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
            timeframe: trade.timeframe,
            reason: trade.reason,
            takeProfit: trade.takeProfit,
            stopLoss: trade.stopLoss,
            profit: trade.profit,
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
          }
        }} />
      ) : (
        <>
          {selectedTrade ? (
            isEditing ? (
              <TradeForm
                userId={userId!}
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

                <button className="logout-button" onClick={handleLogout}>
                  ログアウト
                </button>
              </div>

              {tradeLoadError && (
                <p className="ai-error">
                  ⚠️ {tradeLoadError}
                </p>
              )}

              <div className="dashboard">
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
                    value={`${analysis.totalProfit.toFixed(0)}円`}
                  />

                  <DashboardCard
                    title="平均利益"
                    value={`${analysis.avgProfit.toFixed(0)}円`}
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

              <h2>手法別の勝率</h2>

              <div className="analysis-list">
                {methodAnalysis.map((item) => (
                  <div className="analysis-card" key={item.method}>
                    <h3>{item.method}</h3>
                    <p className="analysis-rate">
                      {item.winRate.toFixed(1)}%
                    </p>
                    <p>
                      {item.winCount}勝 / {item.totalTrades}取引
                    </p>
                  </div>
                ))}
              </div>

              <div className="trade-search">
                <div className="trade-search-header">
                  <div>
                    <p className="trade-search-subtitle">TRADE HISTORY</p>
                    <h2>取引検索</h2>
                  </div>
                </div>

                {/* 銘柄検索 */}
                <div className="trade-search-keyword">
                  <label>銘柄</label>

                  <div className="trade-search-input">
                    <span>⌕</span>

                    <input
                      type="text"
                      value={tradeSearch}
                      onChange={(e) => setTradeSearch(e.target.value)}
                      placeholder="USDJPY、GOLDなど"
                    />
                  </div>
                </div>

                {/* フィルター */}
                <div className="trade-search-filters">
                  {/* 方向 */}
                  <div className="trade-filter-group">
                    <label>方向</label>

                    <div className="filter-buttons">
                      <button
                        type="button"
                        className={directionFilter === "ALL" ? "active" : ""}
                        onClick={() => setDirectionFilter("ALL")}
                      >
                        すべて
                      </button>

                      <button
                        type="button"
                        className={directionFilter === "BUY" ? "active buy" : ""}
                        onClick={() => setDirectionFilter("BUY")}
                      >
                        BUY
                      </button>

                      <button
                        type="button"
                        className={directionFilter === "SELL" ? "active sell" : ""}
                        onClick={() => setDirectionFilter("SELL")}
                      >
                        SELL
                      </button>
                    </div>
                  </div>

                  {/* 結果 */}
                  <div className="trade-filter-group">
                    <label>結果</label>

                    <div className="filter-buttons">
                      <button
                        type="button"
                        className={resultFilter === "ALL" ? "active" : ""}
                        onClick={() => setResultFilter("ALL")}
                      >
                        すべて
                      </button>

                      <button
                        type="button"
                        className={resultFilter === "WIN" ? "active win" : ""}
                        onClick={() => setResultFilter("WIN")}
                      >
                        WIN
                      </button>

                      <button
                        type="button"
                        className={resultFilter === "LOSS" ? "active loss" : ""}
                        onClick={() => setResultFilter("LOSS")}
                      >
                        LOSS
                      </button>

                      <button
                        type="button"
                        className={resultFilter === "DRAW" ? "active draw" : ""}
                        onClick={() => setResultFilter("DRAW")}
                      >
                        DRAW
                      </button>
                    </div>
                  </div>
                </div>

                {/* 期間 */}
                <div className="trade-search-date">
                  <label>期間</label>

                  <div className="trade-date-inputs">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />

                    <span>〜</span>

                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
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
                  {[...filteredTrades]
                    .sort(
                      (a, b) =>
                        new Date(b.entryTime).getTime() -
                        new Date(a.entryTime).getTime()
                    )
                    .slice(0, 5)
                    .map((trade) => (
                      <TradeCard
                        key={trade.id}
                        trade={trade}
                        onDelete={handleDeleteTrade}
                        onSelect={setSelectedTrade}
                      />
                    ))}
                </ul>
              )}
              <button onClick={() => setShowForm((current) => !current)}>
                ＋ 取引を追加
              </button>

              <button
                onClick={testAIAnalysis}
                disabled={isAnalyzing}>
                {isAnalyzing ? "AI分析中" : "AI分析を実行"}
              </button>

              {aiError && (
                <p className="ai-error">
                  ⚠️ AI分析エラー: {aiError}
                </p>
              )}

              {aiAnalysis && (
                <div className="ai-analysis">
                  <h2>🤖 AI分析</h2>

                  <div className="ai-section">
                    <h3>📊 全体分析</h3>
                    <p>{aiAnalysis.summary}</p>
                  </div>

                  <div className="ai-section">
                    <h3>💪 良かった特徴</h3>
                    <ul>
                      {aiAnalysis.strengths.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="ai-section">
                    <h3>⚠️ 注意点</h3>
                    <ul>
                      {aiAnalysis.weaknesses.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="ai-section">
                    <h3>💡 改善ポイント</h3>
                    <ul>
                      {aiAnalysis.improvements.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {showForm && (
                <TradeForm
                  userId={userId!}
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
