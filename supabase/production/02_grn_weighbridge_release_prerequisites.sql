-- Production-only prerequisites for the current GRN/weighbridge release.
-- Structural changes only. No UAT rows, stock movements, or Sage calls.

ALTER TABLE public.goods_received_notes
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE public.sync_log
  ADD COLUMN IF NOT EXISTS description text DEFAULT '';

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.sync_log'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%event_type%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.sync_log DROP CONSTRAINT %I', constraint_name);
  END IF;

  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.sync_log'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.sync_log DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE public.sync_log
  ADD CONSTRAINT sync_log_event_type_check
  CHECK (event_type IN (
    'grn_confirmed', 'materials_issued', 'production_completed',
    'dispatch_delivered', 'price_sync', 'customer_sync', 'error',
    'material_variance_alert', 'macropack_manufactured',
    'reconciliation_variance_approved', 'rm_cost_updated',
    'reconciliation_completed', 'material_transfer_to_production',
    'finished_goods_transfer_to_dispatch', 'stock_take_sage_snapshot'
  ));

ALTER TABLE public.sync_log
  ADD CONSTRAINT sync_log_status_check
  CHECK (status IN (
    'pending', 'processing', 'pending_finance_review', 'success',
    'failed', 'retry'
  ));
