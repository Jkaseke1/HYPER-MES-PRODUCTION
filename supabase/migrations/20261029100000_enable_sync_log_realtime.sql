-- The Production Warehouse subscribes to Sage queue status changes in sync_log.
-- Add the table to Realtime idempotently so status transitions reach open clients.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'sync_log'
    ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_log;
  END IF;
END;
$$;
