import { supabase } from "../lib/supabaseClient";

export type Plan = "free" | "pro";

export type UserSubscription = {
  userId: string;
  plan: Plan;
  proStartedAt: string | null;
  proEndsAt: string | null;
  autoRenew: boolean;
  cancelAtPeriodEnd: boolean;
  updatedAt: string;
};

type SubscriptionRow = {
  user_id: string;
  plan: Plan;
  pro_started_at: string | null;
  pro_ends_at: string | null;
  auto_renew: boolean;
  cancel_at_period_end: boolean;
  updated_at: string;
};

function toUserSubscription(row: SubscriptionRow): UserSubscription {
  return {
    userId: row.user_id,
    plan: row.plan,
    proStartedAt: row.pro_started_at,
    proEndsAt: row.pro_ends_at,
    autoRenew: row.auto_renew,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    updatedAt: row.updated_at,
  };
}

export async function loadMySubscription(expectedUserId: string): Promise<UserSubscription> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!authData.user || authData.user.id !== expectedUserId) {
    throw new Error("ログイン状態を確認できません。再度ログインしてください。");
  }

  const { data, error } = await supabase
    .from("subscriptions")
    .select("user_id, plan, pro_started_at, pro_ends_at, auto_renew, cancel_at_period_end, updated_at")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    return {
      userId: authData.user.id,
      plan: "free",
      proStartedAt: null,
      proEndsAt: null,
      autoRenew: false,
      cancelAtPeriodEnd: false,
      updatedAt: "",
    };
  }

  return toUserSubscription(data as SubscriptionRow);
}
