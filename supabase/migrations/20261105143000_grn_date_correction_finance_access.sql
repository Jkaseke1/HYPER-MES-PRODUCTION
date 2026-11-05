-- Allow Finance to correct only the transaction date on an approved GRN
-- whose latest Sage posting failed and produced no GRV document reference.
-- Supplier corrections remain Admin-only through correct_failed_grn_details.
BEGIN;

CREATE OR REPLACE FUNCTION public.correct_failed_grn_date(
  p_grn_id uuid,
  p_expected_received_date date,
  p_received_date date,
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
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_mes_role(ARRAY['finance']) THEN
    RAISE EXCEPTION 'Only Finance can correct the date on a failed GRN posting.';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'An audit reason is required.';
  END IF;
  IF p_received_date IS NULL THEN
    RAISE EXCEPTION 'A GRN transaction date is required.';
  END IF;

  SELECT * INTO v_grn
  FROM public.goods_received_notes
  WHERE id = p_grn_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GRN % was not found.', p_grn_id;
  END IF;
  IF v_grn.status <> 'approved' OR v_grn.approved_at IS NULL THEN
    RAISE EXCEPTION 'Only an approved GRN can use this correction.';
  END IF;
  IF v_grn.received_date IS DISTINCT FROM p_expected_received_date THEN
    RAISE EXCEPTION 'The GRN changed since it was opened. Refresh and try again.';
  END IF;
  IF v_grn.received_date IS NOT DISTINCT FROM p_received_date THEN
    RAISE EXCEPTION 'No date correction was made.';
  END IF;

  SELECT * INTO v_latest_sync
  FROM public.sync_log
  WHERE event_type = 'grn_confirmed'
    AND reference_type = 'goods_received_notes'
    AND reference_id = p_grn_id
  ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND OR v_latest_sync.status <> 'failed' THEN
    RAISE EXCEPTION 'The latest Sage posting attempt is not failed; this GRN cannot be corrected here.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sync_log
    WHERE event_type = 'grn_confirmed'
      AND reference_type = 'goods_received_notes'
      AND reference_id = p_grn_id
      AND status = 'success'
  ) THEN
    RAISE EXCEPTION 'A successful Sage posting exists. This GRN cannot be corrected here.';
  END IF;
  IF NULLIF(btrim(COALESCE(v_latest_sync.sage_response->>'grvNumber', '')), '') IS NOT NULL
     OR NULLIF(btrim(COALESCE(v_latest_sync.sage_response->>'documentNumber', '')), '') IS NOT NULL
     OR NULLIF(btrim(COALESCE(v_latest_sync.sage_response #>> '{goodsReceipt,grvNumber}', '')), '') IS NOT NULL
     OR NULLIF(btrim(COALESCE(v_latest_sync.sage_response #>> '{goodsReceipt,documentNumber}', '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'The failed Sage response contains a GRV document reference. Reconcile it before correcting.';
  END IF;

  INSERT INTO public.grn_failed_post_correction_audit (
    grn_id, corrected_by, previous_supplier_id, new_supplier_id,
    previous_received_date, new_received_date, reason
  ) VALUES (
    v_grn.id, auth.uid(), v_grn.supplier_id, v_grn.supplier_id,
    v_grn.received_date, p_received_date, btrim(p_reason)
  );

  UPDATE public.goods_received_notes
  SET received_date = p_received_date,
      updated_at = now()
  WHERE id = p_grn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.correct_failed_grn_date(uuid, date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_failed_grn_date(uuid, date, date, text) TO authenticated;

COMMIT;
