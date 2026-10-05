CREATE TABLE IF NOT EXISTS public.community_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.community_posts (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_comments_post_created_at_idx
  ON public.community_comments (post_id, created_at ASC);

ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.community_comments FROM anon, PUBLIC;
GRANT SELECT ON public.community_comments TO authenticated;
GRANT INSERT (post_id, user_id, content) ON public.community_comments TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can read community comments" ON public.community_comments;
CREATE POLICY "Authenticated users can read community comments"
  ON public.community_comments
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can create their own community comments" ON public.community_comments;
CREATE POLICY "Users can create their own community comments"
  ON public.community_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.community_posts AS posts
      WHERE posts.id = community_comments.post_id
    )
  );
