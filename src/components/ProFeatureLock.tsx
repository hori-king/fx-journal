import { useState, type ReactNode } from "react";

interface ProFeatureLockProps {
  title: string;
  isPro: boolean;
  isLoading: boolean;
  labels?: string[];
  compact?: boolean;
  children: ReactNode;
}

function ProFeatureLock({ title, isPro, isLoading, labels = [], compact = false, children }: ProFeatureLockProps) {
  const [showPlanInfo, setShowPlanInfo] = useState(false);

  // クライアント内の分析表示を制御するロック。分析APIを追加するときは、サーバー側でもsubscriptions.planを検証する。
  if (isPro) return <>{children}</>;

  const visibleLabels = labels.slice(0, 8);
  const extraLabelCount = Math.max(0, labels.length - visibleLabels.length);
  const planInfo = showPlanInfo && (
    <p className="pro-feature-plan-info">
      Proプランは月額580円（税込）を予定しています。プラン変更機能は準備中です。
    </p>
  );

  if (compact) {
    return (
      <div className="dashboard-card pro-locked-metric">
        <p className="dashboard-card-title">{title} <span aria-hidden="true">🔒</span></p>
        <p className="pro-feature-locked-value">Proで利用できます</p>
        <button type="button" className="pro-feature-link" onClick={() => setShowPlanInfo((shown) => !shown)}>
          Proプランについて
        </button>
        {planInfo}
      </div>
    );
  }

  return (
    <section className="pro-feature-section" aria-label={`${title}（Pro限定）`}>
      <div className="pro-feature-heading">
        <h2>{title}</h2>
        <span className="pro-feature-badge">🔒 PRO</span>
      </div>
      <div className="pro-feature-locked-panel" aria-live="polite">
        <p className="pro-feature-lock-message">
          {isLoading ? "プランを確認しています…" : "この分析はProプランで利用できます。"}
        </p>
        {visibleLabels.length > 0 && (
          <ul className="pro-feature-labels" aria-label="分析項目">
            {visibleLabels.map((label) => <li key={label}>{label}</li>)}
            {extraLabelCount > 0 && <li>ほか {extraLabelCount} 件</li>}
          </ul>
        )}
        {!isLoading && (
          <button type="button" className="pro-feature-link" onClick={() => setShowPlanInfo((shown) => !shown)}>
            Proプランについて
          </button>
        )}
        {planInfo}
      </div>
    </section>
  );
}

export default ProFeatureLock;
