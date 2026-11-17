-- Finance/Admin may reopen an approved GRN only after a failed Sage attempt
-- that returned no Sage GRV. Stock movements are reversed and snapshotted;
-- failed queue rows are snapshotted before removal so save_grn_correction can
-- accept the audited edit. Re-approval creates a fresh Sage queue event.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.reopen_failed_grn_for_line_correction(
  p_grn_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grn public.goods_received_notes%ROWTYPE;
  v_latest_sync public.sync_log%ROWTYPE;
  v_movement record;
  v_before jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_mes_role(ARRAY['admin', 'finance']) THEN
    RAISE EXCEPTION 'Only Finance or Admin can reopen a failed GRN for line correction.';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'An audit reason is required.';
  END IF;

  SELECT * INTO v_grn
  FROM public.goods_received_notes
  WHERE id = p_grn_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GRN % was not found.', p_grn_id;
  END IF;
  IF v_grn.status <> 'approved' OR v_grn.approved_at IS NULL THEN
    RAISE EXCEPTION 'Only an approved GRN can be reopened.';
  END IF;

  PERFORM id
  FROM public.sync_log
  WHERE event_type = 'grn_confirmed'
    AND reference_type = 'goods_received_notes'
    AND reference_id = p_grn_id
  ORDER BY id
  FOR UPDATE;

  SELECT * INTO v_latest_sync
  FROM public.sync_log
  WHERE event_type = 'grn_confirmed'
    AND reference_type = 'goods_received_notes'
    AND reference_id = p_grn_id
  ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND OR v_latest_sync.status <> 'failed' THEN
    RAISE EXCEPTION 'The latest Sage posting attempt is not failed.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sync_log
    WHERE event_type = 'grn_confirmed'
      AND reference_type = 'goods_received_notes'
      AND reference_id = p_grn_id
      AND status IN ('pending', 'retry', 'processing', 'success')
  ) THEN
    RAISE EXCEPTION 'A Sage posting is pending, processing, or already successful.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sync_log
    WHERE event_type = 'grn_confirmed'
      AND reference_type = 'goods_received_notes'
      AND reference_id = p_grn_id
      AND (
        NULLIF(btrim(COALESCE(sage_response->>'grvNumber', '')), '') IS NOT NULL
        OR NULLIF(btrim(COALESCE(sage_response->>'documentNumber', '')), '') IS NOT NULL
        OR NULLIF(btrim(COALESCE(sage_response #>> '{goodsReceipt,grvNumber}', '')), '') IS NOT NULL
        OR NULLIF(btrim(COALESCE(sage_response #>> '{goodsReceipt,documentNumber}', '')), '') IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'A Sage GRV reference exists. Use the Sage reversal/correction process.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inbound_transport_claims
    WHERE grn_id = p_grn_id AND status NOT IN ('draft', 'rejected')
  ) THEN
    RAISE EXCEPTION 'Resolve the submitted transport claim before correcting this GRN.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE reference_type = 'goods_received_notes'
      AND reference_id = p_grn_id
      AND movement_type = 'receipt'
  ) THEN
    RAISE EXCEPTION 'No recorded Plant Control receipt movement was found. Reconcile stock before reopening this GRN.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.stock_movements receipt
    JOIN public.stock_movements later
      ON later.raw_material_id = receipt.raw_material_id
     AND later.warehouse_id = receipt.warehouse_id
     AND later.created_at > receipt.created_at
    WHERE receipt.reference_type = 'goods_received_notes'
      AND receipt.reference_id = p_grn_id
      AND receipt.movement_type = 'receipt'
      AND later.id <> receipt.id
  ) THEN
    RAISE EXCEPTION 'Later stock movements exist for a received material. Reconcile that stock before reopening this GRN.';
  END IF;

  SELECT jsonb_build_object(
    'reason', btrim(p_reason),
    'header', to_jsonb(v_grn),
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)
      FROM public.grn_items i WHERE i.grn_id = p_grn_id
    ), '[]'::jsonb),
    'stockMovements', COALESCE((
      SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id)
      FROM public.stock_movements m
      WHERE m.reference_type = 'goods_received_notes'
        AND m.reference_id = p_grn_id
    ), '[]'::jsonb),
    'sageEvents', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.created_at, s.id)
      FROM public.sync_log s
      WHERE s.event_type = 'grn_confirmed'
        AND s.reference_type = 'goods_received_notes'
        AND s.reference_id = p_grn_id
    ), '[]'::jsonb)
  ) INTO v_before;

  INSERT INTO public.grn_correction_audit(grn_id, changed_by, before_data, after_data)
  VALUES (
    p_grn_id,
    auth.uid(),
    v_before,
    jsonb_build_object('reason', btrim(p_reason), 'status', 'pending', 'action', 'reopened_for_line_correction')
  );

  -- Reverse the actual receipt movements, then remove them so approval can
  -- recreate movements for the corrected material lines without duplicates.
  FOR v_movement IN
    SELECT id, raw_material_id, warehouse_id, quantity
    FROM public.stock_movements
    WHERE reference_type = 'goods_received_notes'
      AND reference_id = p_grn_id
      AND movement_type = 'receipt'
    FOR UPDATE
  LOOP
    PERFORM public.update_warehouse_balance(
      v_movement.raw_material_id,
      v_movement.warehouse_id,
      -COALESCE(v_movement.quantity, 0)
    );
  END LOOP;
  DELETE FROM public.stock_movements
  WHERE reference_type = 'goods_received_notes'
    AND reference_id = p_grn_id
    AND movement_type = 'receipt';

  -- The failed events are preserved in the audit snapshot. Removing these
  -- failed queue rows lets the guarded correction RPC accept the edited GRV.
  DELETE FROM public.sync_log
  WHERE event_type = 'grn_confirmed'
    AND reference_type = 'goods_received_notes'
    AND reference_id = p_grn_id;

  UPDATE public.goods_received_notes
  SET status = 'pending',
      approved_by = NULL,
      approved_at = NULL,
      rejection_reason = NULL,
      costing_completed_by = NULL,
      costing_completed_at = NULL,
      vat_mode = 'pending_finance',
      vat_treatment = NULL,
      vat_tax_type_id = NULL,
      vat_code = NULL,
      vat_rate = NULL,
      vat_reviewed_by = NULL,
      vat_reviewed_at = NULL,
      updated_at = now()
  WHERE id = p_grn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_failed_grn_for_line_correction(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_failed_grn_for_line_correction(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
