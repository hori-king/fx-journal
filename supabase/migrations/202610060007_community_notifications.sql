CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.community_posts (id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('comment', 'like')),
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_no_self_notification CHECK (recipient_user_id <> actor_user_id)
);

CREATE INDEX IF NOT EXISTS notifications_recipient_created_at_idx
  ON public.notifications (recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON public.notifications (recipient_user_id)
  WHERE is_read = false;

-- 同じ投稿への同じユーザーの未読いいね通知は常に1件までにする。
CREATE UNIQUE INDEX IF NOT EXISTS notifications_one_unread_like_per_actor_post_idx
  ON public.notifications (recipient_user_id, actor_user_id, post_id)
  WHERE type = 'like' AND is_read = false;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.notifications FROM anon, PUBLIC, authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;

DROP POLICY IF EXISTS "Users can read their own notifications" ON public.notifications;
CREATE POLICY "Users can read their own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (recipient_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can mark their own notifications read" ON public.notifications;
CREATE POLICY "Users can mark their own notifications read"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (recipient_user_id = (SELECT auth.uid()))
  WITH CHECK (recipient_user_id = (SELECT auth.uid()) AND is_read = true);

-- 通知先は投稿所有者からDB側で決め、通知保存に失敗しても元のコメントは維持する。
CREATE OR REPLACE FUNCTION public.create_community_comment_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  post_owner_id uuid;
BEGIN
  SELECT posts.user_id
    INTO post_owner_id
    FROM public.community_posts AS posts
    WHERE posts.id = NEW.post_id;

  IF post_owner_id IS NULL OR post_owner_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (recipient_user_id, actor_user_id, post_id, type)
    VALUES (post_owner_id, NEW.user_id, NEW.post_id, 'comment');

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Could not create community comment notification for post %: %', NEW.post_id, SQLERRM;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.create_community_comment_notification() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS community_comments_create_notification ON public.community_comments;
CREATE TRIGGER community_comments_create_notification
  AFTER INSERT ON public.community_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.create_community_comment_notification();

-- いいねの解除時は、そのいいね由来の未読通知だけを消す。既読通知は履歴として残す。
CREATE OR REPLACE FUNCTION public.sync_community_like_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  post_owner_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT posts.user_id
      INTO post_owner_id
      FROM public.community_posts AS posts
      WHERE posts.id = NEW.post_id;

    IF post_owner_id IS NULL OR post_owner_id = NEW.user_id THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.notifications (recipient_user_id, actor_user_id, post_id, type)
      VALUES (post_owner_id, NEW.user_id, NEW.post_id, 'like')
      ON CONFLICT (recipient_user_id, actor_user_id, post_id)
      WHERE type = 'like' AND is_read = false
      DO NOTHING;

    RETURN NEW;
  END IF;

  SELECT posts.user_id
    INTO post_owner_id
    FROM public.community_posts AS posts
    WHERE posts.id = OLD.post_id;

  IF post_owner_id IS NOT NULL AND post_owner_id <> OLD.user_id THEN
    DELETE FROM public.notifications
      WHERE recipient_user_id = post_owner_id
        AND actor_user_id = OLD.user_id
        AND post_id = OLD.post_id
        AND type = 'like'
        AND is_read = false;
  END IF;

  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Could not sync community like notification for post %: %',
      CASE WHEN TG_OP = 'INSERT' THEN NEW.post_id ELSE OLD.post_id END,
      SQLERRM;
    IF TG_OP = 'INSERT' THEN
      RETURN NEW;
    END IF;
    RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_community_like_notification() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS community_likes_sync_notification ON public.community_likes;
CREATE TRIGGER community_likes_sync_notification
  AFTER INSERT OR DELETE ON public.community_likes
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_community_like_notification();
