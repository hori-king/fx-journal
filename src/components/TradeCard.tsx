import { getTradeChartImages, type Trade } from "../tradeData";

interface TradeCardProps {
  trade: Trade;
  onDelete: (id: string) => void;
  onSelect: (trade: Trade) => void;
}

function TradeCard({ trade, onDelete, onSelect }: TradeCardProps) {
  return (
    <li className="trade-card">

      <div className="trade-card-header">
        <div>
          <p className="trade-card-date">{trade.date}</p>
          <h3>{trade.symbol}</h3>
        </div>

        <div className="trade-card-badges">
          <span className={`direction-badge ${trade.direction.toLowerCase()}`}>
            {trade.direction}
          </span>

          <span className={`result-badge ${trade.result.toLowerCase()}`}>
            {trade.result}
          </span>
        </div>
      </div>

      <div className={`trade-profit ${trade.result.toLowerCase()}`}>
        <span>損益</span>
        <strong>
          {trade.profit >= 0 ? "+" : ""}
          {new Intl.NumberFormat("ja-JP", { style: "currency", currency: trade.profitCurrency ?? "JPY", maximumFractionDigits: 0 }).format(trade.profit)}
        </strong>
      </div>

      <div className="trade-card-info">
        <div>
          <span>Entry</span>
          <strong>{trade.entry}</strong>
        </div>

        <div>
          <span>Exit</span>
          <strong>{trade.exit}</strong>
        </div>

        <div>
          <span>RR</span>
          <strong>{trade.rr.toFixed(2)}</strong>
        </div>

        <div>
          <span>時間足</span>
          <strong>{trade.timeframe}</strong>
        </div>
        <div>
          <span>Pips</span>
          <strong>{trade.pips.toFixed(1)}</strong>
        </div>
        <div>
          <span>レバレッジ</span>
          <strong>{trade.leverage ? `${trade.leverage}倍` : "未記録"}</strong>
        </div>
      </div>

      <div className="trade-card-reason">
        <span>取引根拠</span>
        <p>{trade.reason}</p>
      </div>

      {getTradeChartImages(trade).length > 0 && (
        <div className="trade-card-image-gallery">
          {getTradeChartImages(trade).map((image, index) => (
            <img key={index} className="trade-card-image" src={image} alt={`チャート画像 ${index + 1}`} />
          ))}
        </div>
      )}

      <div className="trade-card-actions">
        <button onClick={() => onSelect(trade)}>
          詳細
        </button>

        <button onClick={() => onDelete(trade.id)}>
          削除
        </button>
      </div>

    </li>
  );
}

export default TradeCard;
