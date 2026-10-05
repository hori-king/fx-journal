REVOKE DELETE ON public.community_posts FROM anon, PUBLIC;
REVOKE DELETE ON public.community_comments FROM anon, PUBLIC;
GRANT DELETE ON public.community_posts TO authenticated;
GRANT DELETE ON public.community_comments TO authenticated;

DROP POLICY IF EXISTS "Users can delete their own community posts" ON public.community_posts;
CREATE POLICY "Users can delete their own community posts"
  ON public.community_posts
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own community comments" ON public.community_comments;
CREATE POLICY "Users can delete their own community comments"
  ON public.community_comments
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
