-- 取引データの初期スキーマ・RLS設定がリポジトリ内にないため、所有者制限を明示する。
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.trades FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trades TO authenticated;

DROP POLICY IF EXISTS "Users can manage their own trades" ON public.trades;
CREATE POLICY "Users can manage their own trades"
  ON public.trades
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- 既存の広いPERMISSIVEポリシーがあっても所有者制限を適用する。
DROP POLICY IF EXISTS "Trade rows are restricted to their owner" ON public.trades;
CREATE POLICY "Trade rows are restricted to their owner"
  ON public.trades
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
