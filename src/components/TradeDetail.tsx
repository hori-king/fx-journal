import { getTradeChartImages, type Trade } from "../tradeData";

interface TradeDetailProps {
  trade: Trade;
  onBack: () => void;
  onEdit: () => void;
  onDelete: (id: string) => void;
  onAnalyze: (trade: Trade) => void;
  singleAiAnalysis: {
    summary: string;
    goodPoints: string[];
    cautions: string[];
    improvements: string[];
  } | null;
  isAnalyzing: boolean;
}

function TradeDetail({
  trade,
  onBack,
  onEdit,
  onDelete,
  onAnalyze,
  singleAiAnalysis,
  isAnalyzing,
}: TradeDetailProps) {
  return (
    <div className="trade-detail">

      <div className="trade-detail-header">
        <div className="trade-detail-actions">
          <button
            className="detail-back-button"
            onClick={onBack}
          >
            ← 戻る
          </button>

          <button
            className="detail-edit-button"
            onClick={onEdit}
          >
            編集
          </button>

          <button
            className="detail-delete-button"
            onClick={() => onDelete(trade.id)}
          >
            削除
          </button>
        </div>

        <div>
          <p className="trade-detail-subtitle">
            TRADE DETAIL
          </p>

          <h2>取引詳細</h2>
        </div>

      </div>

      <section className="detail-summary">

        <div>
          <p className="detail-label">銘柄</p>

          <h2>
            {trade.symbol}
            <span className={`detail-direction ${trade.direction.toLowerCase()}`}>
              {trade.direction}
            </span>
          </h2>
        </div>

        <div className={`detail-profit ${trade.result.toLowerCase()}`}>
          <p className="detail-label">損益</p>

          <strong>
            {trade.profit >= 0 ? "+" : ""}
            {new Intl.NumberFormat("ja-JP", { style: "currency", currency: trade.profitCurrency ?? "JPY", maximumFractionDigits: 0 }).format(trade.profit)}
          </strong>

          <span>{trade.result}</span>
        </div>

      </section>

      <button
        className="detail-ai-button"
        onClick={() => onAnalyze(trade)}
        disabled={isAnalyzing}
      >
        {isAnalyzing ? "AI分析中..." : "🤖 この取引をAI分析"}
      </button>

      {getTradeChartImages(trade).length > 0 && (
        <section className="detail-section">

          <div className="detail-section-header">
            <h3>チャート</h3>
          </div>

          <div className="detail-chart">
            <div className="detail-chart-gallery">
              {getTradeChartImages(trade).map((image, index) => (
                <img key={index} src={image} alt={`チャート画像 ${index + 1}`} />
              ))}
            </div>
          </div>

        </section>
      )}

      <section className="detail-section">

        <div className="detail-section-header">
          <h3>価格情報</h3>
        </div>

        <div className="detail-grid">

          <div className="detail-item">
            <span>エントリー価格</span>
            <strong>{trade.entry}</strong>
          </div>

          <div className="detail-item">
            <span>決済価格</span>
            <strong>{trade.exit}</strong>
          </div>

          <div className="detail-item">
            <span>TP（利確）</span>
            <strong>{trade.takeProfit}</strong>
          </div>

          <div className="detail-item">
            <span>SL（損切）</span>
            <strong>{trade.stopLoss}</strong>
          </div>

          <div className="detail-item">
            <span>RR</span>
            <strong>{trade.rr.toFixed(2)}</strong>
          </div>

          <div className="detail-item">
            <span>Pips</span>
            <strong>{trade.pips.toFixed(1)}</strong>
          </div>

        </div>

      </section>

      <section className="detail-section">

        <div className="detail-section-header">
          <h3>取引情報</h3>
        </div>

        <div className="detail-grid">

          <div className="detail-item">
            <span>ロット</span>
            <strong>{trade.lot}</strong>
          </div>

          <div className="detail-item">
            <span>レバレッジ</span>
            <strong>{trade.leverage ? `${trade.leverage}倍` : "未記録"}</strong>
          </div>

          <div className="detail-item">
            <span>時間足</span>
            <strong>{trade.timeframe}</strong>
          </div>

          <div className="detail-item">
            <span>保有時間</span>
            <strong>{trade.holdingTime.toFixed(0)}分</strong>
          </div>

          <div className="detail-item">
            <span>日付</span>
            <strong>{trade.date}</strong>
          </div>

          <div className="detail-item">
            <span>エントリー時間</span>
            <strong>{trade.entryTime}</strong>
          </div>

          <div className="detail-item">
            <span>決済時間</span>
            <strong>{trade.exitTime}</strong>
          </div>

        </div>

      </section>

      <section className="detail-section">

        <div className="detail-section-header">
          <h3>分析</h3>
        </div>

        <div className="detail-reason">
          <span>エントリー根拠</span>
          <p>{trade.reason}</p>
        </div>

      </section>

      {singleAiAnalysis && (
        <div className="ai-analysis">

          <h2>🤖 AI分析</h2>

          <div className="ai-section">
            <h3>総合分析</h3>
            <p>{singleAiAnalysis.summary}</p>
          </div>

          <div className="ai-section">
            <h3>良かった点</h3>

            <ul>
              {singleAiAnalysis.goodPoints.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>
          </div>

          <div className="ai-section">
            <h3>注意点</h3>

            <ul>
              {singleAiAnalysis.cautions.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>
          </div>

          <div className="ai-section">
            <h3>改善ポイント</h3>

            <ul>
              {singleAiAnalysis.improvements.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>

          </div>

        </div>
      )}

    </div>
  );
}

export default TradeDetail;
