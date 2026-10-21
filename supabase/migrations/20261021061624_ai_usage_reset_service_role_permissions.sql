-- Allow the local administrator reset script to delete AI usage only through
-- the service_role key. SELECT is limited to the columns needed to filter the
-- target user and return the deleted row IDs for an accurate count.
GRANT DELETE ON TABLE public.ai_usage TO service_role;
GRANT SELECT (id, user_id) ON TABLE public.ai_usage TO service_role;
