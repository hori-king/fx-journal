-- 契約管理画面向けの利用状況を、既存の上限判定と同じ期間・繰越ルールで読み取る。
-- 認証済みユーザーへ ai_usage の直接参照権限は与えず、バックエンド service_role のみ実行可能にする。
CREATE OR REPLACE FUNCTION public.get_ai_usage_status(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_subscription public.subscriptions%ROWTYPE;
  account_created_at timestamptz;
  effective_plan text;
  period_anchor timestamptz;
  usage_period_start timestamptz;
  usage_reset_at timestamptz;
  free_period_start timestamptz;
  v_now timestamptz := pg_catalog.clock_timestamp();
  single_used integer;
  all_used integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid AI usage status parameters' USING ERRCODE = '22023';
  END IF;

  SELECT subscriptions.*
    INTO current_subscription
    FROM public.subscriptions AS subscriptions
    WHERE subscriptions.user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription record is missing' USING ERRCODE = 'P0002';
  END IF;

  SELECT users.created_at
    INTO account_created_at
    FROM auth.users AS users
    WHERE users.id = p_user_id;

  IF account_created_at IS NULL THEN
    RAISE EXCEPTION 'Authenticated account is missing' USING ERRCODE = 'P0002';
  END IF;

  effective_plan := current_subscription.plan;
  IF effective_plan = 'pro'
     AND current_subscription.pro_ends_at IS NOT NULL
     AND current_subscription.pro_ends_at <= v_now THEN
    effective_plan := 'free';
  END IF;

  IF effective_plan = 'pro' THEN
    period_anchor := coalesce(current_subscription.pro_started_at, account_created_at);
  ELSIF current_subscription.plan = 'pro' THEN
    period_anchor := coalesce(
      current_subscription.pro_ends_at,
      current_subscription.free_period_started_at,
      account_created_at
    );
  ELSE
    period_anchor := coalesce(current_subscription.free_period_started_at, account_created_at);
  END IF;

  SELECT bounds.period_start, bounds.reset_at
    INTO usage_period_start, usage_reset_at
    FROM public.ai_usage_period_bounds(period_anchor, v_now) AS bounds;

  SELECT pg_catalog.count(*)::integer
    INTO single_used
    FROM public.ai_usage AS usage
    WHERE usage.user_id = p_user_id
      AND usage.analysis_type = 'single'
      AND usage.period_start = usage_period_start
      AND (
        usage.status = 'succeeded'
        OR (usage.status = 'reserved' AND usage.reservation_expires_at > v_now)
      );

  SELECT pg_catalog.count(*)::integer
    INTO all_used
    FROM public.ai_usage AS usage
    WHERE usage.user_id = p_user_id
      AND usage.analysis_type = 'all'
      AND usage.period_start = usage_period_start
      AND (
        usage.status = 'succeeded'
        OR (usage.status = 'reserved' AND usage.reservation_expires_at > v_now)
      );

  -- claim_ai_usage と同じく、Pro初月のみ加入直前Free期間の使用数を引き継ぐ。
  IF effective_plan = 'pro'
     AND usage_period_start = current_subscription.pro_started_at
     AND current_subscription.pro_started_at IS NOT NULL THEN
    SELECT bounds.period_start
      INTO free_period_start
      FROM public.ai_usage_period_bounds(
        coalesce(current_subscription.free_period_started_at, account_created_at),
        current_subscription.pro_started_at - interval '1 microsecond'
      ) AS bounds;

    SELECT single_used + pg_catalog.count(*)::integer
      INTO single_used
      FROM public.ai_usage AS usage
      WHERE usage.user_id = p_user_id
        AND usage.analysis_type = 'single'
        AND usage.plan = 'free'
        AND usage.period_start = free_period_start
        AND (
          usage.status = 'succeeded'
          OR (usage.status = 'reserved' AND usage.reservation_expires_at > v_now)
        );

    SELECT all_used + pg_catalog.count(*)::integer
      INTO all_used
      FROM public.ai_usage AS usage
      WHERE usage.user_id = p_user_id
        AND usage.analysis_type = 'all'
        AND usage.plan = 'free'
        AND usage.period_start = free_period_start
        AND (
          usage.status = 'succeeded'
          OR (usage.status = 'reserved' AND usage.reservation_expires_at > v_now)
        );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'plan', effective_plan,
    'periodStart', usage_period_start,
    'periodEnd', usage_reset_at,
    'proStartedAt', current_subscription.pro_started_at,
    'proEndsAt', current_subscription.pro_ends_at,
    'autoRenew', current_subscription.auto_renew,
    'cancelAtPeriodEnd', current_subscription.cancel_at_period_end,
    'single', pg_catalog.jsonb_build_object(
      'usedCount', single_used,
      'limit', CASE WHEN effective_plan = 'pro' THEN 20 ELSE 3 END,
      'remaining', CASE WHEN (CASE WHEN effective_plan = 'pro' THEN 20 ELSE 3 END - single_used) < 0
        THEN 0 ELSE (CASE WHEN effective_plan = 'pro' THEN 20 ELSE 3 END - single_used) END
    ),
    'all', pg_catalog.jsonb_build_object(
      'usedCount', all_used,
      'limit', CASE WHEN effective_plan = 'pro' THEN 5 ELSE 1 END,
      'remaining', CASE WHEN (CASE WHEN effective_plan = 'pro' THEN 5 ELSE 1 END - all_used) < 0
        THEN 0 ELSE (CASE WHEN effective_plan = 'pro' THEN 5 ELSE 1 END - all_used) END
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_ai_usage_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_usage_status(uuid) TO service_role;
