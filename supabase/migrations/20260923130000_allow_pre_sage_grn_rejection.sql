-- Finance may reject a GRN while it is still inside the PlantControl costing
-- and Finance-review stages. Once queued to Sage, it must be handled through
-- the audited return/correction process instead.

CREATE OR REPLACE FUNCTION public.reject_grn(p_grn_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grn public.goods_received_notes%ROWTYPE;
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'finance', 'accountant']) THEN
    RAISE EXCEPTION 'Only Finance, Accountant, or Admin users can reject a GRN.';
  END IF;

  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A rejection reason is required.';
  END IF;

  SELECT * INTO v_grn
  FROM public.goods_received_notes
  WHERE id = p_grn_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GRN % was not found.', p_grn_id;
  END IF;

  IF v_grn.status NOT IN ('pending', 'pending_costing', 'pending_finance') THEN
    RAISE EXCEPTION 'Only GRNs awaiting costing or Finance review can be rejected. Current status: %.', v_grn.status;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sync_log
    WHERE event_type = 'grn_confirmed'
      AND reference_type = 'goods_received_notes'
      AND reference_id = p_grn_id
      AND status IN ('pending', 'processing', 'success')
  ) THEN
    RAISE EXCEPTION 'This GRN has already been queued or posted to Sage and cannot be rejected here. Use the audited Supplier Return or correction process.';
  END IF;

  UPDATE public.goods_received_notes
  SET status = 'rejected',
      approved_by = auth.uid(),
      approved_at = now(),
      rejection_reason = btrim(p_reason),
      updated_at = now()
  WHERE id = p_grn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_grn(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_grn(uuid, text) TO authenticated, service_role;
