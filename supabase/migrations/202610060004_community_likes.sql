CREATE TABLE IF NOT EXISTS public.community_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.community_posts (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_likes_post_user_unique UNIQUE (post_id, user_id)
);

ALTER TABLE public.community_likes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.community_likes FROM anon, PUBLIC;
GRANT SELECT ON public.community_likes TO authenticated;
GRANT INSERT (post_id, user_id) ON public.community_likes TO authenticated;
GRANT DELETE ON public.community_likes TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can read community likes" ON public.community_likes;
CREATE POLICY "Authenticated users can read community likes"
  ON public.community_likes
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can like posts as themselves" ON public.community_likes;
CREATE POLICY "Users can like posts as themselves"
  ON public.community_likes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.community_posts AS posts
      WHERE posts.id = community_likes.post_id
    )
  );

DROP POLICY IF EXISTS "Users can remove their own likes" ON public.community_likes;
CREATE POLICY "Users can remove their own likes"
  ON public.community_likes
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
