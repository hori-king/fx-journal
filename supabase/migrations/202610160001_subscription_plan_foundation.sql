CREATE TABLE public.subscriptions (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro')),
  pro_started_at timestamptz,
  pro_ends_at timestamptz,
  auto_renew boolean NOT NULL DEFAULT false,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.subscriptions FROM anon, PUBLIC, authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;

CREATE POLICY "Users can read their own subscription"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.create_free_subscription_for_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.create_free_subscription_for_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER create_free_subscription_after_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.create_free_subscription_for_new_user();

-- 既存ユーザーもFreeから開始し、再実行時に既存のプラン状態を上書きしない。
INSERT INTO public.subscriptions (user_id)
  SELECT users.id
  FROM auth.users AS users
  ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_subscription_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_subscription_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_subscription_updated_at();
