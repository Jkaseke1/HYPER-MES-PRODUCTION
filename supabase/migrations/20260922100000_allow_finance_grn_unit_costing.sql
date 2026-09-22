-- Finance may correct unit costs while a GRN is still awaiting costing.
-- Approved GRNs remain protected by the existing workflow checks.
CREATE OR REPLACE FUNCTION public.submit_grn_for_finance(p_grn_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grn public.goods_received_notes%ROWTYPE;
  v_missing_costs integer;
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'finance', 'production_receiver', 'supervisor', 'production_manager', 'raw_material_manager']) THEN
    RAISE EXCEPTION 'Only Finance, Production Material Receivers, Supervisors, Production Managers, Raw Materials Managers, or Admin can complete GRN costing.';
  END IF;

  SELECT * INTO v_grn
  FROM public.goods_received_notes
  WHERE id = p_grn_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GRN % was not found.', p_grn_id;
  END IF;

  IF v_grn.status NOT IN ('pending_costing', 'pending') THEN
    RAISE EXCEPTION 'Only GRNs awaiting costing can be submitted to Finance. Current status: %', v_grn.status;
  END IF;

  SELECT COUNT(*) INTO v_missing_costs
  FROM public.grn_items
  WHERE grn_id = p_grn_id
    AND (unit_cost IS NULL OR unit_cost <= 0);

  IF v_missing_costs > 0 THEN
    RAISE EXCEPTION '% GRN line(s) still require a unit cost.', v_missing_costs;
  END IF;

  UPDATE public.goods_received_notes
  SET status = 'pending_finance',
      costing_completed_by = auth.uid(),
      costing_completed_at = now(),
      updated_at = now()
  WHERE id = p_grn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_grn_for_finance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_grn_for_finance(uuid) TO authenticated, service_role;
