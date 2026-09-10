-- Split GRN capture from costing and Finance approval.
-- Warehouse capture may save quantities without prices. An authorized
-- production costing user must complete prices before Finance can approve.

ALTER TABLE public.goods_received_notes
  ADD COLUMN IF NOT EXISTS costing_completed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS costing_completed_at timestamptz;

ALTER TABLE public.goods_received_notes
  DROP CONSTRAINT IF EXISTS goods_received_notes_status_check;

ALTER TABLE public.goods_received_notes
  ADD CONSTRAINT goods_received_notes_status_check
  CHECK (status IN ('pending_costing', 'pending_finance', 'pending', 'rm_approved', 'approved', 'rejected', 'inspecting'));

-- Preserve existing pending records while moving them into the new stages.
UPDATE public.goods_received_notes g
SET status = 'pending_costing', updated_at = now()
WHERE g.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM public.grn_items gi
    WHERE gi.grn_id = g.id AND (gi.unit_cost IS NULL OR gi.unit_cost <= 0)
  );

UPDATE public.goods_received_notes g
SET status = 'pending_finance', updated_at = now()
WHERE g.status = 'pending'
  AND EXISTS (SELECT 1 FROM public.grn_items gi WHERE gi.grn_id = g.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.grn_items gi
    WHERE gi.grn_id = g.id AND (gi.unit_cost IS NULL OR gi.unit_cost <= 0)
  );

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
  IF NOT public.has_mes_role(ARRAY['admin', 'production_receiver', 'supervisor', 'production_manager', 'raw_material_manager']) THEN
    RAISE EXCEPTION 'Only Production Material Receivers, Supervisors, Production Managers, Raw Materials Managers, or Admin can complete GRN costing.';
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

CREATE OR REPLACE FUNCTION public.approve_grn_and_queue(p_grn_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grn public.goods_received_notes%ROWTYPE;
  v_ticket public.weigh_bridge_tickets%ROWTYPE;
  v_total_lines integer;
  v_matching_lines integer;
  v_missing_costs integer;
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'finance', 'accountant']) THEN
    RAISE EXCEPTION 'Only Finance, Accountant, or Admin users can approve a GRN.';
  END IF;

  SELECT * INTO v_grn
  FROM public.goods_received_notes
  WHERE id = p_grn_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GRN % was not found.', p_grn_id;
  END IF;

  IF v_grn.status <> 'pending_finance' THEN
    RAISE EXCEPTION 'Only GRNs submitted for Finance review can be approved.';
  END IF;

  SELECT COUNT(*) INTO v_missing_costs
  FROM public.grn_items
  WHERE grn_id = p_grn_id
    AND (unit_cost IS NULL OR unit_cost <= 0);

  IF v_missing_costs > 0 THEN
    RAISE EXCEPTION 'This GRN still has % line(s) without a unit cost.', v_missing_costs;
  END IF;

  IF v_grn.weigh_bridge_ticket_id IS NOT NULL THEN
    SELECT * INTO v_ticket
    FROM public.weigh_bridge_tickets
    WHERE id = v_grn.weigh_bridge_ticket_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected weighbridge ticket no longer exists.';
    END IF;

    IF v_ticket.status NOT IN ('open', 'linked') THEN
      RAISE EXCEPTION 'Only open weighbridge tickets can be linked to a GRN.';
    END IF;

    IF v_ticket.supplier_id IS DISTINCT FROM v_grn.supplier_id THEN
      RAISE EXCEPTION 'The weighbridge ticket supplier must match the GRN supplier.';
    END IF;

    IF COALESCE(v_ticket.nett_mass, 0) <= 0 OR NOT COALESCE(v_ticket.driver_signed, false) THEN
      RAISE EXCEPTION 'A linked weighbridge ticket requires a positive nett mass and driver sign-off.';
    END IF;

    SELECT COUNT(*), COUNT(*) FILTER (
      WHERE raw_materials.code = v_ticket.product_code
         OR raw_materials.sage_code = v_ticket.product_code
    )
    INTO v_total_lines, v_matching_lines
    FROM public.grn_items
    JOIN public.raw_materials ON raw_materials.id = grn_items.raw_material_id
    WHERE grn_items.grn_id = v_grn.id;

    IF v_total_lines = 0 OR v_total_lines <> v_matching_lines THEN
      RAISE EXCEPTION 'Every GRN line must match the selected weighbridge ticket material.';
    END IF;
  END IF;

  UPDATE public.goods_received_notes
  SET status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
  WHERE id = v_grn.id;

  PERFORM public.sync_approved_grn_to_workflow(v_grn.id);

  INSERT INTO public.sync_log (
    event_type, reference_type, reference_id, status, description, created_at, updated_at
  )
  SELECT 'grn_confirmed', 'goods_received_notes', v_grn.id, 'pending',
         format('GRN %s approved by Finance', v_grn.grn_number), now(), now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.sync_log
    WHERE event_type = 'grn_confirmed'
      AND reference_type = 'goods_received_notes'
      AND reference_id = v_grn.id
      AND status IN ('pending', 'processing', 'success')
  );

  IF v_grn.weigh_bridge_ticket_id IS NOT NULL THEN
    UPDATE public.weigh_bridge_tickets
    SET status = 'linked', updated_at = now()
    WHERE id = v_grn.weigh_bridge_ticket_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_grn_and_queue(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_grn_and_queue(uuid) TO authenticated, service_role;

-- Finance VAT review now occurs after the costing handoff.
CREATE OR REPLACE FUNCTION public.record_grn_vat_review(
  p_grn_id uuid,
  p_vat_mode text,
  p_no_vat_treatment text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'finance', 'accountant']) THEN
    RAISE EXCEPTION 'Only Finance, Accountant, or Admin users can review GRN VAT.';
  END IF;

  IF p_vat_mode NOT IN ('exclusive', 'inclusive', 'no_vat', 'zero_rated') THEN
    RAISE EXCEPTION 'VAT mode is invalid.';
  END IF;

  IF (p_vat_mode = 'no_vat' AND p_no_vat_treatment <> 'exempt')
     OR (p_vat_mode = 'zero_rated' AND p_no_vat_treatment <> 'zero_rated')
     OR (p_vat_mode IN ('exclusive', 'inclusive') AND p_no_vat_treatment IS NOT NULL) THEN
    RAISE EXCEPTION 'VAT classification does not match the selected treatment.';
  END IF;

  UPDATE public.goods_received_notes SET
    vat_mode = p_vat_mode,
    vat_treatment = CASE WHEN p_vat_mode = 'no_vat' THEN 'exempt' WHEN p_vat_mode = 'zero_rated' THEN 'zero_rated' ELSE 'taxable' END,
    vat_tax_type_id = CASE WHEN p_vat_mode = 'no_vat' THEN 7 WHEN p_vat_mode = 'zero_rated' THEN 6 ELSE 9 END,
    vat_code = CASE WHEN p_vat_mode = 'no_vat' THEN '03' WHEN p_vat_mode = 'zero_rated' THEN '02' ELSE '515' END,
    vat_rate = CASE WHEN p_vat_mode IN ('no_vat', 'zero_rated') THEN 0 ELSE 15.5 END,
    vat_reviewed_by = auth.uid(), vat_reviewed_at = now(), updated_at = now()
  WHERE id = p_grn_id AND status = 'pending_finance';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a GRN submitted for Finance review can receive a VAT review.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_grn_vat_review(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_grn_vat_review(uuid, text, text) TO authenticated, service_role;
