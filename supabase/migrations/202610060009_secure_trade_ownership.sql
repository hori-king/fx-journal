-- trades.user_id の参照先を固定し、ユーザー削除時は所有する取引を削除する。
-- NOT VALID で制約を先に追加し、その後既存行を検証する。
ALTER TABLE public.trades
  ADD CONSTRAINT trades_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users (id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.trades
  VALIDATE CONSTRAINT trades_user_id_fkey;

-- 既存Policyを残したまま所有者別Policyを追加し、アクセス制限を維持してから旧Policyを整理する。
CREATE POLICY "trades_select_own"
  ON public.trades
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "trades_insert_own"
  ON public.trades
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "trades_update_own"
  ON public.trades
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "trades_delete_own"
  ON public.trades
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Trade rows are restricted to their owner" ON public.trades;
DROP POLICY IF EXISTS "Users can manage their own trades" ON public.trades;
DROP POLICY IF EXISTS "users can select own trades" ON public.trades;
DROP POLICY IF EXISTS "users can insert own trades" ON public.trades;
DROP POLICY IF EXISTS "users can update own trades" ON public.trades;
DROP POLICY IF EXISTS "users can delete own trades" ON public.trades;

-- anon / PUBLIC には権限を付与せず、authenticated のCRUD権限を明示する。
REVOKE ALL ON public.trades FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trades TO authenticated;
