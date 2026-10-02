import { useRef, useState } from "react";
import {
  addTrade,
  getInstrumentProfitCurrency,
  getPipSize,
  searchXMInstruments,
  type Direction,
  type Timeframe,
  type Trade,
} from "../tradeData";

interface TradeFormProps {
  userId: string;
  accountCurrency: string;
  onAddTrade: (trade: Trade) => void;
  onBack: () => void;
  editTrade?: Trade;
}

function TradeForm({
  userId,
  accountCurrency,
  onAddTrade,
  onBack,
  editTrade,
}: TradeFormProps) {
  const [symbol, setSymbol] = useState(editTrade?.symbol ?? "");
  const [symbolSearch, setSymbolSearch] = useState(editTrade?.symbol ?? "");
  const [showSymbolList, setShowSymbolList] = useState(false);

  const [direction, setDirection] = useState<Direction>(
    editTrade?.direction ?? "BUY"
  );

  const [entry, setEntry] = useState(editTrade?.entry.toString() ?? "");
  const [exit, setExit] = useState(editTrade?.exit.toString() ?? "");
  const [lot, setLot] = useState(editTrade?.lot.toString() ?? "");
  const [leverage, setLeverage] = useState(editTrade?.leverage?.toString() ?? "");
  const [conversionRate, setConversionRate] = useState(editTrade?.conversionRate?.toString() ?? "");
  const [tp, setTp] = useState(editTrade?.takeProfit.toString() ?? "");
  const [sl, setSl] = useState(editTrade?.stopLoss.toString() ?? "");

  const [reason, setReason] = useState(editTrade?.reason ?? "");
  const [chartImage, setChartImage] = useState<File | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [entryTime, setEntryTime] = useState(editTrade?.entryTime ?? "");
  const [exitTime, setExitTime] = useState(editTrade?.exitTime ?? "");

  const [timeframe, setTimeframe] = useState<Timeframe>(
    editTrade?.timeframe ?? "1時間足"
  );

  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const filteredSymbols = searchXMInstruments(symbolSearch).slice(0, 40);
  const nativeProfitCurrency = getInstrumentProfitCurrency(symbol);
  const tradeProfitCurrency = editTrade?.profitCurrency ?? accountCurrency;
  const requiresConversion = Boolean(symbol) && nativeProfitCurrency !== tradeProfitCurrency;

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        resolve(reader.result as string);
      };

      reader.onerror = () => {
        reject(new Error("画像の読み込みに失敗しました"));
      };

      reader.readAsDataURL(file);
    });
  }

  async function handleSave() {
    setSaving(true);

    if (
      symbol === "" ||
      entry === "" ||
      exit === "" ||
      lot === "" ||
      leverage === "" ||
      (requiresConversion && conversionRate === "") ||
      tp === "" ||
      sl === "" ||
      reason === "" ||
      entryTime === "" ||
      exitTime === ""
    ) {
      alert("すべての項目を入力してください。");
      setSaving(false);
      return;
    }

    const entryPrice = Number(entry);
    const exitPrice = Number(exit);
    const lotSize = Number(lot);
    const leverageRatio = Number(leverage);
    const closingConversionRate = requiresConversion ? Number(conversionRate) : 1;
    const takeProfit = Number(tp);
    const stopLoss = Number(sl);

    if (
      entryPrice <= 0 ||
      exitPrice <= 0 ||
      lotSize <= 0 ||
      leverageRatio <= 0 ||
      takeProfit <= 0 ||
      stopLoss <= 0
    ) {
      alert("価格やロット数は0より大きい値を入力してください。");
      setSaving(false);
      return;
    }

    if (!Number.isFinite(closingConversionRate) || closingConversionRate <= 0) {
      alert("決済時の換算レートは0より大きい値を入力してください。");
      setSaving(false);
      return;
    }

    if (direction === "BUY") {
      if (takeProfit <= entryPrice || stopLoss >= entryPrice) {
        alert(
          "BUYの場合、TPはエントリー価格より大きく、SLはエントリー価格より小さい値を入力してください。"
        );
        setSaving(false);
        return;
      }
    }

    if (direction === "SELL") {
      if (takeProfit >= entryPrice || stopLoss <= entryPrice) {
        alert(
          "SELLの場合、TPはエントリー価格より小さく、SLはエントリー価格より大きい値を入力してください。"
        );
        setSaving(false);
        return;
      }
    }

    if (
      new Date(exitTime).getTime() <= new Date(entryTime).getTime()
    ) {
      alert("決済時間はエントリー時間より後の時間を入力してください。");
      setSaving(false);
      return;
    }

    let chartImageUrl = editTrade?.chartImage ?? "";

    try {
      if (chartImage) {
        chartImageUrl = await fileToDataUrl(chartImage);
      }
    } catch (error) {
      alert("画像の読み込みに失敗しました。");
      console.log(error);
      setSaving(false);
      return;
    }

    const createdTrade = addTrade({
      userId: userId,
      symbol: symbol,
      direction: direction,
      entry: Number(entry),
      exit: Number(exit),
      lot: Number(lot),
      leverage: leverageRatio,
      profitCurrency: tradeProfitCurrency,
      conversionRate: closingConversionRate,
      timeframe: timeframe,
      reason: reason,
      methods: editTrade?.methods ?? [],
      takeProfit: Number(tp),
      stopLoss: Number(sl),
      chartImage: chartImageUrl,
      entryTime: entryTime,
      exitTime: exitTime,
    });

    const newTrade = {
      ...createdTrade,
      id: editTrade?.id ?? createdTrade.id,
    };

    onAddTrade(newTrade);

    setSymbol("");
    setSymbolSearch("");
    setShowSymbolList(false);
    setDirection("BUY");
    setEntry("");
    setExit("");
    setLot("");
    setLeverage("");
    setConversionRate("");
    setTp("");
    setSl("");
    setReason("");
    setEntryTime("");
    setExitTime("");
    setTimeframe("1時間足");
    setChartImage(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    setSaving(false);
    setSaved(true);
  }

  return (
    <div className="trade-form">

      <div className="trade-form-header">
        <button type="button" className="back-button" onClick={onBack}>
          {editTrade ? "← 戻る" : "× 閉じる"}
        </button>

        <div>
          <p className="trade-form-subtitle">
            FX TRADING JOURNAL
          </p>

          <h2>
            {editTrade ? "取引を編集" : "取引を追加"}
          </h2>
        </div>
      </div>

      <section className="form-section">
        <div className="form-section-header">
          <h3>基本情報</h3>
          <span>取引の基本設定</span>
        </div>

        <div className="form-grid">

          <div className="form-field symbol-field">
            <label>銘柄</label>

            <input
              value={symbolSearch}
              onChange={(e) => {
                setSymbolSearch(e.target.value);
                setShowSymbolList(true);
                setSaved(false);
              }}
              placeholder="例：USDJPY"
            />

            {showSymbolList && symbolSearch !== "" && (
              <ul>
                {filteredSymbols.map((instrument) => (
                  <li
                    key={instrument.symbol}
                    onClick={() => {
                      setSymbol(instrument.symbol);
                      setSymbolSearch(`${instrument.symbol} — ${instrument.name}`);
                      setShowSymbolList(false);
                    }}
                  >
                    <strong>{instrument.symbol}</strong>
                    <span>{instrument.name} · {instrument.category}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="form-field">
            <label>方向</label>

            <div className="direction-buttons">
              <button
                type="button"
                className={`direction-button buy ${direction === "BUY" ? "active" : ""
                  }`}
                onClick={() => {
                  setDirection("BUY");
                  setSaved(false);
                }}
              >
                BUY
              </button>

              <button
                type="button"
                className={`direction-button sell ${direction === "SELL" ? "active" : ""
                  }`}
                onClick={() => {
                  setDirection("SELL");
                  setSaved(false);
                }}
              >
                SELL
              </button>
            </div>
          </div>

          <div className="form-field">
            <label>時間足</label>

            <select
              value={timeframe}
              onChange={(e) =>
                setTimeframe(e.target.value as Timeframe)
              }
            >
              <option value="1分足">1分足</option>
              <option value="5分足">5分足</option>
              <option value="15分足">15分足</option>
              <option value="30分足">30分足</option>
              <option value="1時間足">1時間足</option>
              <option value="4時間足">4時間足</option>
              <option value="日足">日足</option>
              <option value="週足">週足</option>
              <option value="月足">月足</option>
            </select>
          </div>

        </div>
      </section>

      <section className="form-section">
        <div className="form-section-header">
          <h3>価格・取引情報</h3>
          <span>エントリーと決済</span>
        </div>

        <div className="form-grid">

          <div className="form-field">
            <label>エントリー価格</label>

            <input
              type="number"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              placeholder="例：148.500"
            />
          </div>

          <div className="form-field">
            <label>決済価格</label>

            <input
              type="number"
              value={exit}
              onChange={(e) => setExit(e.target.value)}
              placeholder="例：149.000"
            />
          </div>

          <div className="form-field">
            <label>ロット数</label>

            <input
              type="number"
              value={lot}
              onChange={(e) => setLot(e.target.value)}
              placeholder="例：0.1"
            />
          </div>

          <div className="form-field">
            <label htmlFor="trade-leverage">レバレッジ</label>
            <input
              id="trade-leverage"
              type="number"
              min="1"
              step="1"
              value={leverage}
              onChange={(e) => setLeverage(e.target.value)}
              placeholder="例：25（25倍）"
            />
          </div>

          <div className="form-field pip-size-note">
            <label>この銘柄の1 pip</label>
            <output>{getPipSize(symbol).toLocaleString()}（価格単位）</output>
          </div>

          {requiresConversion && (
            <div className="form-field currency-conversion-field">
              <label htmlFor="trade-conversion-rate">
                決済時の換算レート（1 {nativeProfitCurrency} = ? {tradeProfitCurrency}）
              </label>
              <input
                id="trade-conversion-rate"
                type="number"
                min="0.00000001"
                step="any"
                value={conversionRate}
                onChange={(e) => setConversionRate(e.target.value)}
                placeholder={`例：${nativeProfitCurrency}から${tradeProfitCurrency}への決済時レート`}
              />
              <small>決済時点の換算レートを入力してください。</small>
            </div>
          )}

          <p className="trade-form-pnl-note">
            損益は価格差・ロット・XMの契約サイズ・換算レートから計算します。手数料とスワップは含みません。
          </p>

          <div className="tp-sl-row">
            <div className="form-field tp-field">
              <label>TP（利確）</label>

              <input
                type="number"
                value={tp}
                onChange={(e) => setTp(e.target.value)}
                placeholder="利確価格"
              />
            </div>

            <div className="form-field sl-field">
              <label>SL（損切）</label>

              <input
                type="number"
                value={sl}
                onChange={(e) => setSl(e.target.value)}
                placeholder="損切価格"
              />
            </div>
          </div>

        </div>
      </section>

      <section className="form-section">
        <div className="form-section-header">
          <h3>取引時間</h3>
          <span>エントリーから決済まで</span>
        </div>

        <div className="form-grid">

          <div className="form-field">
            <label>エントリー時間</label>

            <input
              type="datetime-local"
              value={entryTime}
              onChange={(e) => setEntryTime(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label>決済時間</label>

            <input
              type="datetime-local"
              value={exitTime}
              onChange={(e) => setExitTime(e.target.value)}
            />
          </div>

        </div>
      </section>

      <section className="form-section">
        <div className="form-section-header">
          <h3>分析</h3>
          <span>なぜこの取引をしたか</span>
        </div>

        <div className="form-field">
          <label>根拠</label>

          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例：水平線＋包み足"
          />
        </div>

        <div className="chart-image-field">
          <label>チャート画像</label>

          <label className="chart-upload-area">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setChartImage(file);
                setSaved(false);
              }}
            />

            <span className="chart-upload-icon">＋</span>

            <strong>チャート画像を選択</strong>

            <span>
              JPG・PNGなどの画像をアップロード
            </span>
          </label>

          {chartImage && (
            <div className="chart-preview">
              <img
                src={URL.createObjectURL(chartImage)}
                alt="チャート画像プレビュー"
              />

              <button
                type="button"
                className="chart-remove-button"
                onClick={() => {
                  setChartImage(null);

                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                }}
              >
                画像を削除
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="trade-form-footer">

        <button
          className="form-cancel-button"
          onClick={onBack}
        >
          キャンセル
        </button>

        <button
          className="form-save-button"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "保存中..." : editTrade ? "変更を保存" : "取引を保存"}
        </button>

      </div>

      {saved && (
        <p className="form-success">
          ✓ 取引が保存されました。
        </p>
      )}

    </div>
  );
}

export default TradeForm;
