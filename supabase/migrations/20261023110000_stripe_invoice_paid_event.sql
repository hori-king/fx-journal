-- Stripe's subscription entitlement guidance uses invoice.paid. Keep the RPC
-- allowlist and activation branch aligned with the verified webhook handler.
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
    'invoice.paid', 'invoice.payment_failed',
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

  IF p_event_type = 'invoice.paid' THEN
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

REVOKE ALL ON FUNCTION public.apply_stripe_billing_event(text, text, text, text, uuid, text, text, timestamptz, timestamptz, boolean, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_stripe_billing_event(text, text, text, text, uuid, text, text, timestamptz, timestamptz, boolean, boolean, timestamptz) TO service_role;
