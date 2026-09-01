-- A stock take must compare physical counts against a deliberate Sage SDK
-- snapshot, never against the mutable MES stock projection.

ALTER TABLE public.stock_takes
  ADD COLUMN IF NOT EXISTS baseline_source text,
  ADD COLUMN IF NOT EXISTS baseline_snapshot_at timestamptz,
  ADD COLUMN IF NOT EXISTS baseline_sync_status text NOT NULL DEFAULT 'READY',
  ADD COLUMN IF NOT EXISTS baseline_sync_message text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.stock_takes
  DROP CONSTRAINT IF EXISTS stock_takes_baseline_sync_status_check;

ALTER TABLE public.stock_takes
  ADD CONSTRAINT stock_takes_baseline_sync_status_check
  CHECK (baseline_sync_status IN ('SYNCING', 'READY', 'FAILED'));

-- Existing completed counts predate this source marker. Preserve them as a
-- historical MES baseline instead of incorrectly labelling them as SDK data.
UPDATE public.stock_takes
SET baseline_source = COALESCE(baseline_source, 'legacy_mes'),
    baseline_sync_status = COALESCE(baseline_sync_status, 'READY')
WHERE baseline_source IS NULL;

-- Permit the bridge request that creates an all-RM Sage SDK snapshot before a
-- new count receives its stock-take lines.
DO $migration$
DECLARE v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.sync_log'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%event_type%';
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.sync_log DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END
$migration$;

ALTER TABLE public.sync_log
  ADD CONSTRAINT sync_log_event_type_check
  CHECK (event_type IN (
    'grn_confirmed', 'materials_issued', 'production_completed',
    'dispatch_delivered', 'price_sync', 'customer_sync', 'error',
    'material_variance_alert', 'macropack_manufactured',
    'reconciliation_variance_approved', 'rm_cost_updated',
    'reconciliation_completed', 'material_transfer_to_production',
    'finished_goods_transfer_to_dispatch', 'stock_take_sage_snapshot'
  )) NOT VALID;

COMMENT ON COLUMN public.stock_takes.baseline_source IS
  'System baseline source. New controlled stock takes must use sage_sdk.';
COMMENT ON COLUMN public.stock_takes.baseline_snapshot_at IS
  'Timestamp of the immutable Sage SDK RM quantity snapshot used for the count.';
