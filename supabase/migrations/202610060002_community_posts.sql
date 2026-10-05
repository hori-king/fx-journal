CREATE TABLE IF NOT EXISTS public.community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_posts_created_at_idx
  ON public.community_posts (created_at DESC);

ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.community_posts FROM anon, PUBLIC;
GRANT SELECT ON public.community_posts TO authenticated;
GRANT INSERT (user_id, content) ON public.community_posts TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can read community posts" ON public.community_posts;
CREATE POLICY "Authenticated users can read community posts"
  ON public.community_posts
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can create their own community posts" ON public.community_posts;
CREATE POLICY "Users can create their own community posts"
  ON public.community_posts
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
