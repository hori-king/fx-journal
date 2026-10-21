import { useEffect, useState } from "react";
import { loadMyAIUsageStatus, type AIUsageQuota, type AIUsageStatus } from "../services/aiUsageService";

type PlanManagementPageProps = { userId: string };

function formatJst(value: string | null): string {
  if (!value) return "未設定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未設定";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function UsageCard({ title, quota }: { title: string; quota: AIUsageQuota }) {
  const percent = Math.min(100, Math.round((quota.usedCount / quota.limit) * 100));
  return (
    <article className="plan-usage-card">
      <div className="plan-usage-copy">
        <h3>{title}</h3>
        <p><strong>{quota.usedCount}</strong><span> / {quota.limit} 回使用</span></p>
      </div>
      <div
        className="plan-usage-track"
        role="progressbar"
        aria-label={`${title}の利用回数`}
        aria-valuemin={0}
        aria-valuemax={quota.limit}
        aria-valuenow={Math.min(quota.usedCount, quota.limit)}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="plan-usage-remaining">残り {quota.remaining} 回</p>
    </article>
  );
}

function PlanManagementPage({ userId }: PlanManagementPageProps) {
  const [status, setStatus] = useState<AIUsageStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upgradeMessage, setUpgradeMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    loadMyAIUsageStatus()
      .then((usageStatus) => {
        if (active) setStatus(usageStatus);
      })
      .catch((loadError: unknown) => {
        console.error("契約管理情報の読み込みに失敗しました:", loadError);
        if (active) setError(loadError instanceof Error ? loadError.message : "契約情報を取得できませんでした。");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [userId, refreshKey]);

  function refreshStatus() {
    setIsLoading(true);
    setStatus(null);
    setError(null);
    setRefreshKey((current) => current + 1);
  }

  if (isLoading) {
    return <section className="home-page plan-page" aria-label="プラン管理" aria-busy="true"><p className="plan-message">契約情報を読み込んでいます…</p></section>;
  }
  if (error || !status) {
    return <section className="home-page plan-page" aria-label="プラン管理">
      <div className="plan-heading"><div><p className="trade-search-subtitle">PLAN &amp; BILLING</p><h2>プラン・契約管理</h2></div></div>
      <p className="plan-message plan-error" role="alert">{error ?? "契約情報を取得できませんでした。"}</p>
      <button type="button" className="plan-secondary-button" onClick={refreshStatus}>再読み込み</button>
    </section>;
  }

  const isPro = status.plan === "pro";
  const price = isPro ? "月額 580円（税込）" : "¥0";
  const contractDateLabel = status.cancelAtPeriodEnd
    ? "契約終了日時"
    : status.autoRenew ? "次回更新日時" : "契約終了日時";

  return (
    <section className="home-page plan-page" aria-label="プラン管理">
      <div className="plan-heading">
        <div><p className="trade-search-subtitle">PLAN &amp; BILLING</p><h2>プラン・契約管理</h2></div>
        <button type="button" className="plan-secondary-button" onClick={refreshStatus}>再読み込み</button>
      </div>

      <article className={`plan-status-card${isPro ? " is-pro" : " is-free"}`}>
        <div className="plan-status-topline">
          <span className={`plan-badge ${isPro ? "pro" : "free"}`}>{isPro ? "PRO" : "FREE"}</span>
          <span className="plan-price">{price}</span>
        </div>
        <h3>現在のプラン</h3>
        <p className="plan-status-name">{isPro ? "Proプラン" : "Freeプラン"}</p>
        {isPro ? (
          <dl className="plan-contract-details">
            <div><dt>Pro開始日時</dt><dd>{formatJst(status.proStartedAt)}</dd></div>
            <div><dt>{contractDateLabel}</dt><dd>{formatJst(status.proEndsAt)}</dd></div>
            <div><dt>自動更新</dt><dd>{status.cancelAtPeriodEnd ? "期間終了後に解約予定" : status.autoRenew ? "有効" : "無効"}</dd></div>
            <div><dt>AI利用期間</dt><dd>{formatJst(status.periodStart)} 〜 {formatJst(status.periodEnd)}</dd></div>
          </dl>
        ) : (
          <dl className="plan-contract-details">
            <div><dt>Free利用期間の開始</dt><dd>{formatJst(status.periodStart)}</dd></div>
            <div><dt>利用期間終了・リセット</dt><dd>{formatJst(status.periodEnd)}</dd></div>
          </dl>
        )}
      </article>

      <div className="plan-section-heading"><div><p className="trade-search-subtitle">AI USAGE</p><h3>AI分析の利用状況</h3></div><span>期間終了時にリセット</span></div>
      <div className="plan-usage-grid">
        <UsageCard title="個別取引AI分析" quota={status.single} />
        <UsageCard title="全取引AI分析" quota={status.all} />
      </div>

      {!isPro && (
        <article className="plan-upgrade-card">
          <div>
            <p className="trade-search-subtitle">PRO PLAN</p>
            <h3>Proで、さらに記録を活用</h3>
            <p>詳細な分析機能と、より多くのAI分析をご利用いただけます。</p>
            <strong>月額580円（税込）</strong>
          </div>
          <button type="button" onClick={() => setUpgradeMessage("決済機能は現在準備中です。利用開始できるようになったら、この画面からご案内します。")}>
            Proにアップグレード
          </button>
          {upgradeMessage && <p className="plan-preparation-message" role="status">{upgradeMessage}</p>}
        </article>
      )}
    </section>
  );
}

export default PlanManagementPage;
