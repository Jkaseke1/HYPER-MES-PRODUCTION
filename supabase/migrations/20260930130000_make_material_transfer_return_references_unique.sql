-- Each PD -> RM return line needs a unique Sage reference. An IST can contain
-- many materials, while Sage treats a repeated warehouse-transfer reference as
-- a conflict (HTTP 409). Preserve posted historical references and repair only
-- returns that are safe to retry or have not been claimed by the bridge.

UPDATE public.material_transfer_reversals
SET sage_reference = CASE
  WHEN upper(coalesce(original_ist_number, '')) ~ '^HFIST[0-9]+$'
    THEN left('HFRV' || substring(upper(original_ist_number) FROM 6) || '-' || upper(right(replace(original_transfer_id::text, '-', ''), 6)), 50)
  ELSE 'HFRV-' || upper(substring(replace(original_transfer_id::text, '-', '') FROM 1 FOR 8))
END,
sage_reference2 = left(format('MES return to RM %s; original %s', reversal_number, coalesce(nullif(original_ist_number, ''), 'transfer')), 50),
updated_at = now()
WHERE status IN ('pending', 'failed');

CREATE UNIQUE INDEX IF NOT EXISTS uq_material_transfer_reversals_sage_reference
  ON public.material_transfer_reversals (sage_reference);

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
    WHEN v_original_ist ~ '^HFIST[0-9]+$' THEN left('HFRV' || substring(v_original_ist FROM 6) || '-' || upper(right(replace(v_transfer.id::text, '-', ''), 6)), 50)
    ELSE 'HFRV-' || upper(substring(replace(v_transfer.id::text, '-', '') FROM 1 FOR 8))
  END;

  IF v_reversal_exists THEN
    v_reversal_id := v_reversal.id;
    UPDATE public.material_transfer_reversals
    SET reason = btrim(p_reason), status = 'pending', requested_by = p_requested_by,
        sage_reference = v_sage_reference,
        sage_reference2 = left(format('MES return to RM %s; original %s', v_reversal.reversal_number, coalesce(nullif(v_original_ist, ''), v_transfer.transfer_number)), 50),
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

REVOKE ALL ON FUNCTION public.request_material_transfer_return_to_rm(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_material_transfer_return_to_rm(uuid, uuid, text) TO authenticated, service_role;
