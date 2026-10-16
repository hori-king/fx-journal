ALTER TABLE public.subscriptions
  ADD COLUMN free_period_started_at timestamptz;

UPDATE public.subscriptions AS subscriptions
SET free_period_started_at = users.created_at
FROM auth.users AS users
WHERE subscriptions.user_id = users.id
  AND subscriptions.free_period_started_at IS NULL
  AND subscriptions.plan = 'free';

CREATE TABLE public.ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  analysis_type text NOT NULL CHECK (analysis_type IN ('single', 'all')),
  plan text NOT NULL CHECK (plan IN ('free', 'pro')),
  period_start timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('reserved', 'succeeded', 'failed')),
  reservation_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT ai_usage_reservation_expiry_check CHECK (
    (status = 'reserved' AND reservation_expires_at IS NOT NULL AND completed_at IS NULL)
    OR (status <> 'reserved' AND reservation_expires_at IS NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX ai_usage_period_count_idx
  ON public.ai_usage (user_id, analysis_type, period_start, status);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage FROM anon, PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.create_free_subscription_for_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, free_period_started_at)
    VALUES (NEW.id, NEW.created_at)
    ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.create_free_subscription_for_new_user() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_subscription_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.plan = 'free' AND NEW.plan = 'pro'
     AND NEW.pro_started_at IS NOT DISTINCT FROM OLD.pro_started_at THEN
    NEW.pro_started_at = pg_catalog.clock_timestamp();
  END IF;

  IF OLD.plan = 'free' AND NEW.plan = 'pro'
     AND NEW.pro_ends_at IS NOT DISTINCT FROM OLD.pro_ends_at THEN
    NEW.pro_ends_at = NEW.pro_started_at + interval '1 month';
  ELSIF OLD.plan = 'pro' AND NEW.plan = 'free' THEN
    NEW.free_period_started_at = pg_catalog.clock_timestamp();
  END IF;

  NEW.updated_at = pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_subscription_updated_at() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ai_usage_period_bounds(
  p_anchor timestamptz,
  p_now timestamptz
)
RETURNS TABLE (period_start timestamptz, reset_at timestamptz)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  anchor_utc timestamp without time zone := p_anchor AT TIME ZONE 'UTC';
  now_utc timestamp without time zone := p_now AT TIME ZONE 'UTC';
  month_offset integer;
BEGIN
  IF anchor_utc > now_utc THEN
    RETURN QUERY
      SELECT p_anchor, (anchor_utc + pg_catalog.make_interval(months => 1)) AT TIME ZONE 'UTC';
    RETURN;
  END IF;

  month_offset :=
    (extract(year FROM now_utc)::integer - extract(year FROM anchor_utc)::integer) * 12
    + extract(month FROM now_utc)::integer - extract(month FROM anchor_utc)::integer;

  IF anchor_utc + pg_catalog.make_interval(months => month_offset) > now_utc THEN
    month_offset := month_offset - 1;
  END IF;

  RETURN QUERY
    SELECT
      (anchor_utc + pg_catalog.make_interval(months => month_offset)) AT TIME ZONE 'UTC',
      (anchor_utc + pg_catalog.make_interval(months => month_offset + 1)) AT TIME ZONE 'UTC';
END;
$$;

REVOKE ALL ON FUNCTION public.ai_usage_period_bounds(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_ai_usage(
  p_user_id uuid,
  p_analysis_type text
)
RETURNS jsonb
LANGUAGE plpgsql
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
  usage_limit integer;
  used_count integer;
  reservation_id uuid;
  reservation_ttl interval := pg_catalog.make_interval(mins => 15);
BEGIN
  IF p_user_id IS NULL OR p_analysis_type IS NULL OR p_analysis_type NOT IN ('single', 'all') THEN
    RAISE EXCEPTION 'Invalid AI usage claim parameters' USING ERRCODE = '22023';
  END IF;

  SELECT subscriptions.*
    INTO current_subscription
    FROM public.subscriptions AS subscriptions
    WHERE subscriptions.user_id = p_user_id
    FOR UPDATE;

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
    usage_limit := CASE WHEN p_analysis_type = 'single' THEN 20 ELSE 5 END;
  ELSE
    IF current_subscription.plan = 'pro' THEN
      period_anchor := coalesce(
        current_subscription.pro_ends_at,
        current_subscription.free_period_started_at,
        account_created_at
      );
    ELSE
      period_anchor := coalesce(current_subscription.free_period_started_at, account_created_at);
    END IF;
    usage_limit := CASE WHEN p_analysis_type = 'single' THEN 3 ELSE 1 END;
  END IF;

  SELECT bounds.period_start, bounds.reset_at
    INTO usage_period_start, usage_reset_at
    FROM public.ai_usage_period_bounds(period_anchor, v_now) AS bounds;

  -- 期限切れ予約は消費扱いせず解放し、処理中予約だけを上限判定へ含める。
  UPDATE public.ai_usage AS usage
    SET status = 'failed',
        reservation_expires_at = NULL,
        completed_at = v_now
    WHERE usage.user_id = p_user_id
      AND usage.status = 'reserved'
      AND usage.reservation_expires_at <= v_now;

  SELECT pg_catalog.count(*)::integer
    INTO used_count
    FROM public.ai_usage AS usage
    WHERE usage.user_id = p_user_id
      AND usage.analysis_type = p_analysis_type
      AND usage.period_start = usage_period_start
      AND (
        usage.status = 'succeeded'
        OR (usage.status = 'reserved' AND usage.reservation_expires_at > v_now)
      );

  -- 最初のPro期間だけ、加入直前のFree期間での成功・処理中利用を同種枠へ引き継ぐ。
  IF effective_plan = 'pro'
     AND usage_period_start = current_subscription.pro_started_at
     AND current_subscription.pro_started_at IS NOT NULL THEN
    SELECT bounds.period_start
      INTO free_period_start
      FROM public.ai_usage_period_bounds(
        coalesce(current_subscription.free_period_started_at, account_created_at),
        current_subscription.pro_started_at - interval '1 microsecond'
      ) AS bounds;

    SELECT used_count + pg_catalog.count(*)::integer
      INTO used_count
      FROM public.ai_usage AS usage
      WHERE usage.user_id = p_user_id
        AND usage.analysis_type = p_analysis_type
        AND usage.plan = 'free'
        AND usage.period_start = free_period_start
        AND (
          usage.status = 'succeeded'
          OR (usage.status = 'reserved' AND usage.reservation_expires_at > v_now)
        );
  END IF;

  IF used_count >= usage_limit THEN
    RETURN pg_catalog.jsonb_build_object(
      'allowed', false,
      'reservationId', NULL,
      'plan', effective_plan,
      'analysisType', p_analysis_type,
      'usedCount', used_count,
      'limit', usage_limit,
      'remaining', 0,
      'periodStart', usage_period_start,
      'resetAt', usage_reset_at
    );
  END IF;

  INSERT INTO public.ai_usage (
    user_id, analysis_type, plan, period_start, status, reservation_expires_at
  ) VALUES (
    p_user_id, p_analysis_type, effective_plan, usage_period_start, 'reserved', v_now + reservation_ttl
  )
  RETURNING id INTO reservation_id;

  RETURN pg_catalog.jsonb_build_object(
    'allowed', true,
    'reservationId', reservation_id,
    'plan', effective_plan,
    'analysisType', p_analysis_type,
    'usedCount', used_count + 1,
    'limit', usage_limit,
    'remaining', usage_limit - used_count - 1,
    'periodStart', usage_period_start,
    'resetAt', usage_reset_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_ai_usage(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_usage(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_ai_usage(
  p_usage_id uuid,
  p_succeeded boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  changed_rows integer;
BEGIN
  UPDATE public.ai_usage AS usage
    SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
        reservation_expires_at = NULL,
        completed_at = pg_catalog.clock_timestamp()
    WHERE usage.id = p_usage_id
      AND usage.status IN ('reserved', 'succeeded');

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RETURN changed_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_ai_usage(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_ai_usage(uuid, boolean) TO service_role;
