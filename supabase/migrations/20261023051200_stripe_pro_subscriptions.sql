-- Stripe契約のサーバー専用状態と、Webhookの重複排除を追加する。
ALTER TABLE public.subscriptions
  ADD COLUMN billing_provider text CHECK (billing_provider IN ('stripe', 'paypay')),
  ADD COLUMN stripe_customer_id text UNIQUE,
  ADD COLUMN stripe_subscription_id text UNIQUE,
  ADD COLUMN stripe_price_id text,
  ADD COLUMN pro_checkout_lock_until timestamptz;

-- Stripe内部IDとCheckoutロックはクライアントから読めないようにする。
REVOKE SELECT ON public.subscriptions FROM authenticated;
GRANT SELECT (user_id, plan, pro_started_at, pro_ends_at, auto_renew, cancel_at_period_end, updated_at)
  ON public.subscriptions TO authenticated;

CREATE TABLE public.stripe_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_webhook_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.stripe_webhook_events FROM service_role;

-- Stripe状態変更は署名検証済みWebhookとcheckout APIからのみ実行する。
CREATE OR REPLACE FUNCTION public.reserve_pro_checkout(
  p_user_id uuid,
  p_lock_until timestamptz
)
RETURNS TABLE (allowed boolean, stripe_customer_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  subscription_row public.subscriptions%ROWTYPE;
BEGIN
  SELECT subscriptions.* INTO subscription_row
  FROM public.subscriptions AS subscriptions
  WHERE subscriptions.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text;
    RETURN;
  END IF;

  IF (subscription_row.plan = 'pro'
      AND (subscription_row.pro_ends_at IS NULL OR subscription_row.pro_ends_at > pg_catalog.clock_timestamp()))
     OR (subscription_row.pro_checkout_lock_until IS NOT NULL
         AND subscription_row.pro_checkout_lock_until > pg_catalog.clock_timestamp()) THEN
    RETURN QUERY SELECT false, subscription_row.stripe_customer_id;
    RETURN;
  END IF;

  UPDATE public.subscriptions
  SET pro_checkout_lock_until = p_lock_until
  WHERE user_id = p_user_id;
  RETURN QUERY SELECT true, subscription_row.stripe_customer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_pro_checkout_customer(
  p_user_id uuid,
  p_customer_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.subscriptions
  SET stripe_customer_id = p_customer_id
  WHERE user_id = p_user_id
    AND pro_checkout_lock_until > pg_catalog.clock_timestamp()
    AND (stripe_customer_id IS NULL OR stripe_customer_id = p_customer_id);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_pro_checkout(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.subscriptions
  SET pro_checkout_lock_until = NULL
  WHERE user_id = p_user_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_stripe_billing_event(
  p_event_id text,
  p_event_type text,
  p_customer_id text,
  p_subscription_id text,
  p_user_id uuid,
  p_price_id text,
  p_subscription_status text,
  p_paid_at timestamptz,
  p_period_end timestamptz,
  p_auto_renew boolean,
  p_cancel_at_period_end boolean,
  p_event_created_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  subscription_row public.subscriptions%ROWTYPE;
  inserted_rows integer;
BEGIN
  IF p_event_id IS NULL OR p_event_type IS NULL OR p_event_type NOT IN (
    'invoice.payment_succeeded', 'invoice.payment_failed',
    'customer.subscription.updated', 'customer.subscription.deleted'
  ) THEN
    RAISE EXCEPTION 'Invalid Stripe event' USING ERRCODE = '22023';
  END IF;

  SELECT subscriptions.* INTO subscription_row
  FROM public.subscriptions AS subscriptions
  WHERE subscriptions.stripe_customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND OR (p_user_id IS NOT NULL AND subscription_row.user_id <> p_user_id) THEN
    RAISE EXCEPTION 'Stripe customer mapping not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.stripe_webhook_events (event_id, event_type)
  VALUES (p_event_id, p_event_type)
  ON CONFLICT (event_id) DO NOTHING;
  GET DIAGNOSTICS inserted_rows = ROW_COUNT;
  IF inserted_rows = 0 THEN
    RETURN 'duplicate';
  END IF;

  IF p_event_type = 'invoice.payment_succeeded' THEN
    IF p_subscription_id IS NULL OR p_price_id IS NULL OR p_paid_at IS NULL
       OR p_period_end IS NULL OR p_subscription_status <> 'active'
       OR p_auto_renew IS NULL OR p_cancel_at_period_end IS NULL THEN
      RAISE EXCEPTION 'Stripe paid invoice is incomplete or inactive' USING ERRCODE = '22023';
    END IF;

    UPDATE public.subscriptions
    SET plan = 'pro',
        pro_started_at = CASE
          WHEN plan = 'pro' AND stripe_subscription_id = p_subscription_id
            THEN pro_started_at
          ELSE p_paid_at
        END,
        pro_ends_at = p_period_end,
        auto_renew = p_auto_renew,
        cancel_at_period_end = p_cancel_at_period_end,
        billing_provider = 'stripe',
        stripe_subscription_id = p_subscription_id,
        stripe_price_id = p_price_id,
        pro_checkout_lock_until = NULL
    WHERE user_id = subscription_row.user_id;
  ELSIF p_event_type = 'invoice.payment_failed' THEN
    UPDATE public.subscriptions
    SET plan = 'free',
        free_period_started_at = CASE
        WHEN plan = 'pro' THEN COALESCE(p_event_created_at, pg_catalog.clock_timestamp())
          ELSE free_period_started_at
        END,
        pro_ends_at = NULL,
        auto_renew = false,
        cancel_at_period_end = false,
        pro_checkout_lock_until = NULL
    WHERE user_id = subscription_row.user_id
      AND (stripe_subscription_id IS NULL OR stripe_subscription_id = p_subscription_id OR plan = 'free');
  ELSIF p_event_type = 'customer.subscription.updated' THEN
    IF p_subscription_id = subscription_row.stripe_subscription_id
       AND p_period_end IS NOT NULL THEN
      UPDATE public.subscriptions
      SET pro_ends_at = CASE WHEN plan = 'pro' THEN p_period_end ELSE pro_ends_at END,
          auto_renew = CASE WHEN plan = 'pro' THEN p_auto_renew ELSE auto_renew END,
          cancel_at_period_end = CASE WHEN plan = 'pro' THEN p_cancel_at_period_end ELSE cancel_at_period_end END
      WHERE user_id = subscription_row.user_id;
    END IF;
  ELSIF p_event_type = 'customer.subscription.deleted' THEN
    UPDATE public.subscriptions
    SET plan = 'free',
        free_period_started_at = CASE
          WHEN plan = 'pro' THEN COALESCE(p_event_created_at, pg_catalog.clock_timestamp())
          ELSE free_period_started_at
        END,
        pro_ends_at = NULL,
        auto_renew = false,
        cancel_at_period_end = false,
        pro_checkout_lock_until = NULL
    WHERE user_id = subscription_row.user_id
      AND stripe_subscription_id = p_subscription_id;
  END IF;

  RETURN 'applied';
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_pro_checkout(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_pro_checkout_customer(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_pro_checkout(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_stripe_billing_event(text, text, text, text, uuid, text, text, timestamptz, timestamptz, boolean, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_pro_checkout(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_pro_checkout_customer(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_pro_checkout(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_stripe_billing_event(text, text, text, text, uuid, text, text, timestamptz, timestamptz, boolean, boolean, timestamptz) TO service_role;

-- 既存トリガーはPro終了時刻を常にDB現在時刻へ上書きするため、署名済みWebhookの発生時刻を維持する。
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
  ELSIF OLD.plan = 'pro' AND NEW.plan = 'free'
     AND NEW.free_period_started_at IS NOT DISTINCT FROM OLD.free_period_started_at THEN
    NEW.free_period_started_at = pg_catalog.clock_timestamp();
  END IF;

  NEW.updated_at = pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_subscription_updated_at() FROM PUBLIC, anon, authenticated;
