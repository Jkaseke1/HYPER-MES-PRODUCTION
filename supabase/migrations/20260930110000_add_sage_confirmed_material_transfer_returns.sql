-- A completed IST is immutable. A return to RM is a new, linked PD -> RM
-- transaction that is posted in Sage before PlantControl updates its ledgers.

ALTER TABLE public.sync_log
  DROP CONSTRAINT IF EXISTS sync_log_event_type_check;

ALTER TABLE public.sync_log
  ADD CONSTRAINT sync_log_event_type_check
  CHECK (event_type IN (
    'grn_confirmed', 'supplier_return', 'materials_issued', 'production_completed',
    'dispatch_delivered', 'price_sync', 'customer_sync', 'error',
    'material_variance_alert', 'macropack_manufactured',
    'reconciliation_variance_approved', 'rm_cost_updated',
    'reconciliation_completed', 'material_transfer_to_production',
    'material_transfer_return_to_rm',
    'finished_goods_transfer_to_dispatch', 'stock_take_sage_snapshot',
    'sage_stock_refresh', 'return_to_supplier_requested'
  )) NOT VALID;

CREATE TABLE IF NOT EXISTS public.material_transfer_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reversal_number text NOT NULL UNIQUE,
  original_transfer_id uuid NOT NULL UNIQUE REFERENCES public.material_transfers(id),
  original_ist_number text,
  raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'kg',
  reason text NOT NULL,
  sage_reference text NOT NULL,
  sage_reference2 text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'posted', 'failed', 'cancelled')),
  requested_by uuid NOT NULL REFERENCES public.profiles(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  failed_at timestamptz,
  failure_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.material_transfer_reversals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read material transfer returns"
  ON public.material_transfer_reversals
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_material_transfer_reversals_status
  ON public.material_transfer_reversals(status, requested_at DESC);

CREATE OR REPLACE FUNCTION public.request_material_transfer_reversal_sage_refresh(
  p_material_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id uuid;
  v_reference_id uuid := gen_random_uuid();
  v_ids uuid[];
  v_codes text[];
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'finance', 'accountant']) THEN
    RAISE EXCEPTION 'Only Finance, Accountant, or Admin can validate a return to RM.';
  END IF;
  IF COALESCE(cardinality(p_material_ids), 0) = 0 OR cardinality(p_material_ids) > 20 THEN
    RAISE EXCEPTION 'Select between one and 20 materials to refresh.';
  END IF;

  SELECT array_agg(id ORDER BY id),
         array_agg(upper(coalesce(nullif(sage_code, ''), code)) ORDER BY id)
    INTO v_ids, v_codes
  FROM public.raw_materials
  WHERE id = ANY(p_material_ids);

  IF COALESCE(cardinality(v_ids), 0) <> cardinality(ARRAY(SELECT DISTINCT unnest(p_material_ids)))
     OR EXISTS (SELECT 1 FROM unnest(v_codes) AS code WHERE code IS NULL OR code = '') THEN
    RAISE EXCEPTION 'Every selected material must have a Sage item code.';
  END IF;

  INSERT INTO public.sync_log (event_type, reference_type, reference_id, status, message, details)
  VALUES (
    'sage_stock_refresh', 'sage_stock', v_reference_id, 'pending',
    'Queued to read live Sage PD stock before return to RM',
    jsonb_build_object('materialIds', v_ids, 'itemCodes', v_codes, 'warehouseCodes', jsonb_build_array('PD'), 'requestedBy', auth.uid())
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_material_transfer_return_to_rm(
  p_transfer_id uuid,
  p_requested_by uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer public.material_transfers%ROWTYPE;
  v_reversal public.material_transfer_reversals%ROWTYPE;
  v_reversal_id uuid;
  v_reversal_number text;
  v_pd_warehouse_id uuid;
  v_sage_pd_quantity numeric;
  v_sage_synced_at timestamptz;
  v_mes_pd_quantity numeric;
  v_original_ist text;
  v_sage_reference text;
  v_reversal_exists boolean := false;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_requested_by THEN
    RAISE EXCEPTION 'Authenticated user must request the return.';
  END IF;
  IF NOT public.has_mes_role(ARRAY['admin', 'finance', 'accountant']) THEN
    RAISE EXCEPTION 'Only Finance, Accountant, or Admin can return a posted transfer to RM.';
  END IF;
  IF nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A return reason is required.';
  END IF;

  SELECT * INTO v_transfer
  FROM public.material_transfers
  WHERE id = p_transfer_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Material transfer not found.'; END IF;
  IF v_transfer.status <> 'received' OR v_transfer.reversed_at IS NOT NULL OR v_transfer.reversed_by IS NOT NULL THEN
    RAISE EXCEPTION 'Only a completed, non-reversed transfer can be returned to RM.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sync_log
    WHERE event_type = 'material_transfer_to_production'
      AND reference_id = v_transfer.id
      AND status = 'success'
  ) THEN
    RAISE EXCEPTION 'The original RM to PD transfer has not been confirmed by Sage and cannot be returned.';
  END IF;

  SELECT id INTO v_pd_warehouse_id
  FROM public.warehouses
  WHERE upper(code) = 'PRODUCTION' AND is_active
  LIMIT 1;
  IF v_pd_warehouse_id IS NULL THEN RAISE EXCEPTION 'Production Warehouse not found.'; END IF;

  SELECT quantity, last_synced_at
    INTO v_sage_pd_quantity, v_sage_synced_at
  FROM public.sage_stock_balances
  WHERE raw_material_id = v_transfer.raw_material_id
    AND warehouse_id = 19;
  IF v_sage_synced_at IS NULL OR v_sage_synced_at < now() - interval '2 minutes' THEN
    RAISE EXCEPTION 'Live Sage PD stock must be refreshed before returning this material.';
  END IF;
  IF coalesce(v_sage_pd_quantity, 0) < v_transfer.quantity THEN
    RAISE EXCEPTION 'Insufficient Sage PD stock. Available: %, required: %.', coalesce(v_sage_pd_quantity, 0), v_transfer.quantity;
  END IF;

  SELECT coalesce(quantity, 0) INTO v_mes_pd_quantity
  FROM public.warehouse_stock_balances
  WHERE raw_material_id = v_transfer.raw_material_id
    AND warehouse_id = v_pd_warehouse_id
  FOR UPDATE;
  IF coalesce(v_mes_pd_quantity, 0) < v_transfer.quantity THEN
    RAISE EXCEPTION 'Insufficient PlantControl Production stock. Available: %, required: %.', coalesce(v_mes_pd_quantity, 0), v_transfer.quantity;
  END IF;

  SELECT * INTO v_reversal
  FROM public.material_transfer_reversals
  WHERE original_transfer_id = v_transfer.id
  FOR UPDATE;
  v_reversal_exists := FOUND;

  IF v_reversal_exists AND v_reversal.status = 'posted' THEN
    RAISE EXCEPTION 'This transfer was already returned to RM as %.', v_reversal.reversal_number;
  END IF;
  IF v_reversal_exists AND v_reversal.status IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'A return to RM is already queued for this transfer as %.', v_reversal.reversal_number;
  END IF;

  v_original_ist := upper(btrim(coalesce(v_transfer.purpose, '')));
  v_sage_reference := CASE
    WHEN v_original_ist ~ '^HFIST[0-9]+$' THEN 'HFRV' || substring(v_original_ist FROM 6)
    ELSE 'HFRV-' || upper(substring(replace(v_transfer.id::text, '-', '') FROM 1 FOR 8))
  END;

  IF v_reversal_exists THEN
    v_reversal_id := v_reversal.id;
    UPDATE public.material_transfer_reversals
    SET reason = btrim(p_reason), status = 'pending', requested_by = p_requested_by,
        requested_at = now(), failed_at = NULL, failure_message = NULL, updated_at = now()
    WHERE id = v_reversal_id;
  ELSE
    v_reversal_id := gen_random_uuid();
    v_reversal_number := 'MTRR-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substring(replace(v_reversal_id::text, '-', '') FROM 1 FOR 6));
    INSERT INTO public.material_transfer_reversals (
      id, reversal_number, original_transfer_id, original_ist_number, raw_material_id,
      quantity, unit, reason, sage_reference, sage_reference2, requested_by
    ) VALUES (
      v_reversal_id, v_reversal_number, v_transfer.id, nullif(v_original_ist, ''), v_transfer.raw_material_id,
      v_transfer.quantity, coalesce(nullif(v_transfer.unit, ''), 'kg'), btrim(p_reason),
      v_sage_reference,
      left(format('MES return to RM %s; original %s', v_reversal_number, coalesce(nullif(v_original_ist, ''), v_transfer.transfer_number)), 50),
      p_requested_by
    );
  END IF;

  INSERT INTO public.sync_log (event_type, reference_type, reference_id, status, message, details)
  VALUES (
    'material_transfer_return_to_rm', 'material_transfer_reversal', v_reversal_id,
    'pending', 'Return to RM queued for Sage validation and posting',
    jsonb_build_object('originalTransferId', v_transfer.id, 'originalIst', nullif(v_original_ist, ''), 'requestedBy', p_requested_by)
  );

  RETURN v_reversal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_material_transfer_return_to_rm(p_reversal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reversal public.material_transfer_reversals%ROWTYPE;
  v_pd_warehouse_id uuid;
  v_rm_warehouse_id uuid;
  v_pd_quantity numeric;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the Sage bridge can finalize a return to RM.';
  END IF;
  SELECT * INTO v_reversal FROM public.material_transfer_reversals WHERE id = p_reversal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material transfer return was not found.'; END IF;
  IF v_reversal.status = 'posted' THEN RETURN; END IF;
  IF v_reversal.status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'Only a pending Sage return can be finalized. Current status: %.', v_reversal.status;
  END IF;

  SELECT id INTO v_pd_warehouse_id FROM public.warehouses WHERE upper(code) = 'PRODUCTION' AND is_active LIMIT 1;
  SELECT id INTO v_rm_warehouse_id FROM public.warehouses WHERE upper(code) = 'RM' AND is_active LIMIT 1;
  IF v_pd_warehouse_id IS NULL OR v_rm_warehouse_id IS NULL THEN RAISE EXCEPTION 'PD or RM warehouse is not configured.'; END IF;
  SELECT coalesce(quantity, 0) INTO v_pd_quantity
  FROM public.warehouse_stock_balances
  WHERE raw_material_id = v_reversal.raw_material_id AND warehouse_id = v_pd_warehouse_id
  FOR UPDATE;
  IF coalesce(v_pd_quantity, 0) < v_reversal.quantity THEN
    RAISE EXCEPTION 'PlantControl PD balance changed before Sage confirmation. Available: %, required: %.', coalesce(v_pd_quantity, 0), v_reversal.quantity;
  END IF;

  PERFORM public.update_warehouse_balance(v_reversal.raw_material_id, v_pd_warehouse_id, -v_reversal.quantity);
  PERFORM public.update_warehouse_balance(v_reversal.raw_material_id, v_rm_warehouse_id, v_reversal.quantity);

  INSERT INTO public.stock_movements (raw_material_id, movement_type, quantity, warehouse_id, reference_type, reference_id, unit, movement_date, performed_by, notes)
  SELECT v_reversal.raw_material_id, 'transfer', -v_reversal.quantity, v_pd_warehouse_id,
         'material_transfer_reversal', v_reversal.id, v_reversal.unit, now(), v_reversal.requested_by,
         format('Sage-confirmed return to RM: %s', v_reversal.reversal_number)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE reference_type = 'material_transfer_reversal' AND reference_id = v_reversal.id AND warehouse_id = v_pd_warehouse_id
  );
  INSERT INTO public.stock_movements (raw_material_id, movement_type, quantity, warehouse_id, reference_type, reference_id, unit, movement_date, performed_by, notes)
  SELECT v_reversal.raw_material_id, 'transfer', v_reversal.quantity, v_rm_warehouse_id,
         'material_transfer_reversal', v_reversal.id, v_reversal.unit, now(), v_reversal.requested_by,
         format('Sage-confirmed return from PD: %s', v_reversal.reversal_number)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE reference_type = 'material_transfer_reversal' AND reference_id = v_reversal.id AND warehouse_id = v_rm_warehouse_id
  );
  UPDATE public.material_transfer_reversals SET status = 'posted', posted_at = now(), updated_at = now() WHERE id = v_reversal.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_material_transfer_return_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.event_type = 'material_transfer_return_to_rm' AND NEW.reference_type = 'material_transfer_reversal' THEN
    IF NEW.status = 'processing' THEN
      UPDATE public.material_transfer_reversals SET status = 'processing', updated_at = now()
      WHERE id = NEW.reference_id AND status = 'pending';
    ELSIF NEW.status = 'failed' THEN
      UPDATE public.material_transfer_reversals
      SET status = 'failed', failed_at = now(), failure_message = NEW.message, updated_at = now()
      WHERE id = NEW.reference_id AND status <> 'posted';
    ELSIF NEW.status = 'pending' THEN
      UPDATE public.material_transfer_reversals SET status = 'pending', updated_at = now()
      WHERE id = NEW.reference_id AND status = 'failed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_material_transfer_return_status ON public.sync_log;
CREATE TRIGGER trg_sync_material_transfer_return_status
  AFTER UPDATE OF status ON public.sync_log
  FOR EACH ROW EXECUTE FUNCTION public.sync_material_transfer_return_status();

REVOKE ALL ON FUNCTION public.request_material_transfer_reversal_sage_refresh(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_material_transfer_return_to_rm(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_material_transfer_return_to_rm(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_material_transfer_reversal_sage_refresh(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_material_transfer_return_to_rm(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_material_transfer_return_to_rm(uuid) TO service_role;
