-- Stripe契約管理APIが本人の契約行をサーバー側で参照できるようにする。
-- service_role専用の読み取り権限であり、authenticatedユーザーの権限は変更しない。
GRANT SELECT ON public.subscriptions TO service_role;
