import { useEffect, useState } from "react";
import { loadMySubscription, type UserSubscription } from "../services/subscriptionService";

export function useSubscription(userId: string | null) {
  const [result, setResult] = useState<{
    userId: string;
    subscription?: UserSubscription;
    error?: string;
  } | null>(null);

  useEffect(() => {
    let isActive = true;

    if (!userId) return;

    loadMySubscription(userId)
      .then((currentSubscription) => {
        if (isActive) setResult({ userId, subscription: currentSubscription });
      })
      .catch((loadError: unknown) => {
        console.error("プラン情報の読み込みに失敗しました:", loadError);
        if (isActive) setResult({ userId, error: "プラン情報を取得できませんでした。" });
      });

    return () => {
      isActive = false;
    };
  }, [userId]);

  const currentResult = result?.userId === userId ? result : null;
  return {
    subscription: currentResult?.subscription ?? null,
    error: currentResult?.error ?? null,
  };
}
