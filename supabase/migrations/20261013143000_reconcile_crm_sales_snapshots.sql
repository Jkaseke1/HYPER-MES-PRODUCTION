-- Tag each successful read-only Sage sales import so stale PlantControl rows
-- can be safely removed after the complete source window has been imported.
ALTER TABLE public.crm_customer_sales_daily
  ADD COLUMN IF NOT EXISTS source_sync_run_id uuid;

CREATE INDEX IF NOT EXISTS idx_crm_customer_sales_daily_sync_run
  ON public.crm_customer_sales_daily (source_sync_run_id);

NOTIFY pgrst, 'reload schema';
