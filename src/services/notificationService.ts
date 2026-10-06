import { supabase } from "../lib/supabaseClient";
import {
  COMMUNITY_FALLBACK_DISPLAY_NAME,
  loadProfilesByUserIds,
} from "./profileService";

export type NotificationType = "comment" | "like";

export type CommunityNotification = {
  id: string;
  recipientUserId: string;
  actorUserId: string;
  actorDisplayName: string;
  postId: string;
  type: NotificationType;
  isRead: boolean;
  createdAt: string;
};

type NotificationRow = {
  id: string;
  recipient_user_id: string;
  actor_user_id: string;
  post_id: string;
  type: NotificationType;
  is_read: boolean;
  created_at: string;
};

export async function loadNotifications(userId: string): Promise<CommunityNotification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, recipient_user_id, actor_user_id, post_id, type, is_read, created_at")
    .eq("recipient_user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as NotificationRow[];
  const profiles = await loadProfilesByUserIds(rows.map((row) => row.actor_user_id));
  return rows.map((row) => ({
    id: row.id,
    recipientUserId: row.recipient_user_id,
    actorUserId: row.actor_user_id,
    actorDisplayName: profiles.get(row.actor_user_id) ?? COMMUNITY_FALLBACK_DISPLAY_NAME,
    postId: row.post_id,
    type: row.type,
    isRead: row.is_read,
    createdAt: row.created_at,
  }));
}

export async function loadUnreadNotificationCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_user_id", userId)
    .eq("is_read", false);

  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationRead(notificationId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", notificationId)
    .eq("recipient_user_id", userId)
    .eq("is_read", false)
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}
