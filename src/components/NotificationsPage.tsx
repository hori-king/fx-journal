import { useCallback, useEffect, useState } from "react";
import {
  loadNotifications,
  markNotificationRead,
  type CommunityNotification,
} from "../services/notificationService";

type NotificationsPageProps = {
  userId: string;
  onNotificationRead: () => void;
  onOpenPost: (postId: string) => void;
};

function formatNotificationDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時不明";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function NotificationsPage({ userId, onNotificationRead, onOpenPost }: NotificationsPageProps) {
  const [notifications, setNotifications] = useState<CommunityNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [openingNotificationId, setOpeningNotificationId] = useState<string | null>(null);

  const refreshNotifications = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setNotifications(await loadNotifications(userId));
    } catch (error) {
      console.error("通知の読み込みに失敗しました:", error);
      setLoadError("通知を読み込めませんでした。時間をおいて再度お試しください。");
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    let isActive = true;
    loadNotifications(userId)
      .then((items) => {
        if (isActive) setNotifications(items);
      })
      .catch((error: unknown) => {
        console.error("通知の読み込みに失敗しました:", error);
        if (isActive) setLoadError("通知を読み込めませんでした。時間をおいて再度お試しください。");
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [userId]);

  async function handleOpenNotification(notification: CommunityNotification) {
    if (openingNotificationId) return;
    setOpeningNotificationId(notification.id);
    setActionError(null);
    try {
      if (!notification.isRead) {
        const wasMarkedRead = await markNotificationRead(notification.id, userId);
        setNotifications((current) => current.map((item) =>
          item.id === notification.id ? { ...item, isRead: true } : item,
        ));
        if (wasMarkedRead) onNotificationRead();
      }
      onOpenPost(notification.postId);
    } catch (error) {
      console.error("通知を既読にできませんでした:", error);
      setActionError("通知を開けませんでした。通信状態を確認してもう一度お試しください。");
    } finally {
      setOpeningNotificationId(null);
    }
  }

  return (
    <section className="home-page notifications-page" aria-label="通知">
      <div className="notifications-heading">
        <div>
          <p className="trade-search-subtitle">NOTIFICATIONS</p>
          <h2>通知</h2>
        </div>
        <button
          type="button"
          className="community-refresh"
          onClick={() => void refreshNotifications()}
          disabled={isLoading}
        >
          {isLoading ? "読み込み中…" : "再読み込み"}
        </button>
      </div>

      {loadError && <p className="community-error" role="alert">{loadError}</p>}
      {actionError && <p className="community-error" role="alert">{actionError}</p>}
      {isLoading ? (
        <p className="community-empty" role="status">通知を読み込んでいます…</p>
      ) : notifications.length === 0 ? (
        <p className="community-empty">通知はありません。</p>
      ) : (
        <div className="notification-list">
          {notifications.map((notification) => (
            <button
              type="button"
              key={notification.id}
              className={`notification-card${notification.isRead ? " is-read" : " is-unread"}`}
              onClick={() => void handleOpenNotification(notification)}
              disabled={openingNotificationId !== null}
            >
              <span className="notification-status" aria-hidden="true">
                {notification.isRead ? "✓" : "●"}
              </span>
              <span className="notification-copy">
                <span className="notification-message">
                  <strong>{notification.actorDisplayName}</strong>
                  さんがあなたの投稿に{notification.type === "comment" ? "コメント" : "いいね"}しました
                </span>
                <time dateTime={notification.createdAt}>{formatNotificationDate(notification.createdAt)}</time>
              </span>
              <span className="notification-open-label">
                {openingNotificationId === notification.id ? "開いています…" : "投稿を見る →"}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export default NotificationsPage;
