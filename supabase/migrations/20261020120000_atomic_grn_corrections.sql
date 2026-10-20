-- Schema change only: enables audited pre-approval correction; does not edit receipts or post to Sage.
BEGIN;

CREATE TABLE public.grn_correction_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid NOT NULL REFERENCES public.goods_received_notes(id),
  changed_by uuid NOT NULL REFERENCES public.profiles(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  before_data jsonb NOT NULL,
  after_data jsonb NOT NULL
);
ALTER TABLE public.grn_correction_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.grn_correction_audit FROM anon, authenticated;
GRANT SELECT ON public.grn_correction_audit TO authenticated;
CREATE POLICY "Managers can read GRV correction history" ON public.grn_correction_audit
  FOR SELECT TO authenticated USING (public.has_mes_role(ARRAY[
    'admin', 'finance', 'accountant', 'raw_material_manager', 'rm_manager', 'warehouse_manager', 'production_manager'
  ]));

CREATE OR REPLACE FUNCTION public.save_grn_correction(
  p_grn_id uuid, p_expected_updated_at timestamptz, p_expected_lines jsonb,
  p_header jsonb, p_lines jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_grn public.goods_received_notes%ROWTYPE;
  v_ticket public.weigh_bridge_tickets%ROWTYPE;
  v_new_ticket uuid;
  v_supplier uuid;
  v_date date;
  v_before jsonb;
  v_after jsonb;
  v_saved_lines jsonb;
  v_expected_lines jsonb;
  v_total numeric;
  v_line record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_mes_role(ARRAY[
    'admin', 'finance', 'accountant', 'raw_material_manager', 'rm_manager', 'warehouse_manager', 'production_manager'
  ]) THEN RAISE EXCEPTION 'Only Finance or an authorised manager can correct a GRV.'; END IF;

  SELECT * INTO v_grn FROM public.goods_received_notes WHERE id = p_grn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GRV not found.'; END IF;
  IF v_grn.status NOT IN ('pending', 'pending_costing', 'pending_finance')
     OR v_grn.approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Approved or progressed GRVs are locked.';
  END IF;
  IF v_grn.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'GRV changed since opening. Reopen it before correcting.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sync_log WHERE reference_id = p_grn_id
      AND event_type = 'grn_confirmed') THEN
    RAISE EXCEPTION 'This GRV has a Sage queue history. Reconcile it before correcting.';
  END IF;
  PERFORM id FROM public.grn_items WHERE grn_id = p_grn_id ORDER BY id FOR UPDATE;
  IF jsonb_typeof(p_expected_lines) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_header) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Supply the complete GRV header and lines.';
  END IF;
  SELECT jsonb_agg(to_jsonb(x) ORDER BY id) INTO v_saved_lines FROM (
    SELECT id, raw_material_id, coalesce(ordered_qty, 0) AS ordered_qty,
      received_qty, coalesce(unit_cost, 0) AS unit_cost,
      nullif(batch_number, '') AS batch_number, expiry_date
    FROM public.grn_items WHERE grn_id = p_grn_id
  ) x;
  SELECT jsonb_agg(to_jsonb(x) ORDER BY id) INTO v_expected_lines
    FROM jsonb_to_recordset(p_expected_lines) AS x(id uuid, raw_material_id uuid,
      ordered_qty numeric, received_qty numeric, unit_cost numeric, batch_number text, expiry_date date);
  IF v_saved_lines IS NULL OR v_saved_lines IS DISTINCT FROM v_expected_lines THEN
    RAISE EXCEPTION 'GRV lines changed or were not fully loaded. Reopen the GRV.';
  END IF;
  IF jsonb_array_length(p_lines) = 0 OR jsonb_array_length(p_lines) > 500 THEN
    RAISE EXCEPTION 'Supply between 1 and 500 GRV lines.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(id uuid, raw_material_id uuid,
      ordered_qty numeric, received_qty numeric, unit_cost numeric)
    WHERE x.raw_material_id IS NULL OR NOT public.grn_input_allowed(x.raw_material_id)
      OR x.ordered_qty IS NULL OR x.ordered_qty < 0
      OR x.received_qty IS NULL OR x.received_qty <= 0 OR x.unit_cost IS NULL OR x.unit_cost < 0
      OR x.ordered_qty::text IN ('NaN', 'Infinity', '-Infinity')
      OR x.received_qty::text IN ('NaN', 'Infinity', '-Infinity')
      OR x.unit_cost::text IN ('NaN', 'Infinity', '-Infinity')
      OR (x.id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.grn_items gi WHERE gi.id = x.id AND gi.grn_id = p_grn_id)))
    OR EXISTS (SELECT x.id FROM jsonb_to_recordset(p_lines) AS x(id uuid)
      WHERE x.id IS NOT NULL GROUP BY x.id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Invalid or duplicate GRV line, material, quantity or cost.';
  END IF;
  v_supplier := nullif(p_header->>'supplier_id', '')::uuid;
  v_new_ticket := nullif(p_header->>'weigh_bridge_ticket_id', '')::uuid;
  v_date := nullif(p_header->>'received_date', '')::date;
  IF v_date IS NULL OR coalesce(p_header->>'manual_grv_number', '') !~ '^HFGRV[0-9]+$'
     OR (v_supplier IS NULL AND nullif(btrim(p_header->>'unregistered_supplier_name'), '') IS NULL) THEN
    RAISE EXCEPTION 'Receipt date, supplier and manual HFGRV number are required.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.goods_received_notes WHERE id <> p_grn_id
      AND upper(btrim(manual_grv_number)) = upper(btrim(p_header->>'manual_grv_number'))
      AND status <> 'rejected') THEN
    RAISE EXCEPTION 'That manual GRV reference is already in use.';
  END IF;
  -- Ticket locks and all receipt edits share this transaction with the approval parent lock.
  PERFORM id FROM public.weigh_bridge_tickets
    WHERE id IN (v_grn.weigh_bridge_ticket_id, v_new_ticket) ORDER BY id FOR UPDATE;
  IF v_new_ticket IS DISTINCT FROM v_grn.weigh_bridge_ticket_id AND EXISTS (
      SELECT 1 FROM public.inbound_transport_claims WHERE grn_id = p_grn_id) THEN
    RAISE EXCEPTION 'This GRV has linked transport evidence. Resolve it before replacing its weighbridge ticket.';
  END IF;
  IF v_new_ticket IS NOT NULL THEN
    SELECT * INTO v_ticket FROM public.weigh_bridge_tickets WHERE id = v_new_ticket;
    IF NOT FOUND OR v_ticket.status NOT IN ('open', 'in_grn', 'linked') THEN
      RAISE EXCEPTION 'The selected weighbridge ticket is not available.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.goods_received_notes WHERE weigh_bridge_ticket_id = v_new_ticket
        AND id <> p_grn_id AND status <> 'rejected') THEN
      RAISE EXCEPTION 'The selected weighbridge ticket belongs to another GRV.';
    END IF;
  END IF;
  SELECT jsonb_build_object('header', to_jsonb(v_grn), 'lines', jsonb_agg(to_jsonb(gi) ORDER BY gi.id))
    INTO v_before FROM public.grn_items gi WHERE grn_id = p_grn_id;
  IF v_grn.weigh_bridge_ticket_id IS DISTINCT FROM v_new_ticket THEN
    UPDATE public.weigh_bridge_tickets SET status = 'open', updated_at = now()
      WHERE id = v_grn.weigh_bridge_ticket_id AND status IN ('in_grn', 'linked');
  END IF;
  UPDATE public.weigh_bridge_tickets SET status = 'in_grn', supplier_id = v_supplier,
    unregistered_supplier_name = CASE WHEN v_supplier IS NULL THEN btrim(p_header->>'unregistered_supplier_name') ELSE NULL END,
    updated_at = now() WHERE id = v_new_ticket;

  DELETE FROM public.grn_items gi WHERE grn_id = p_grn_id AND NOT EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(id uuid) WHERE x.id = gi.id);
  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(id uuid, raw_material_id uuid,
    ordered_qty numeric, received_qty numeric, unit_cost numeric, batch_number text, expiry_date date)
  LOOP
    IF v_line.id IS NULL THEN
      INSERT INTO public.grn_items(grn_id, raw_material_id, ordered_qty, received_qty, unit_cost, batch_number, expiry_date, line_total)
        VALUES (p_grn_id, v_line.raw_material_id, v_line.ordered_qty, v_line.received_qty, v_line.unit_cost,
          v_line.batch_number, v_line.expiry_date, v_line.received_qty * v_line.unit_cost);
    ELSE
      UPDATE public.grn_items SET raw_material_id = v_line.raw_material_id, ordered_qty = v_line.ordered_qty,
        received_qty = v_line.received_qty, unit_cost = v_line.unit_cost, batch_number = v_line.batch_number,
        expiry_date = v_line.expiry_date, line_total = v_line.received_qty * v_line.unit_cost
        WHERE id = v_line.id AND grn_id = p_grn_id;
    END IF;
  END LOOP;
  SELECT sum(received_qty * unit_cost) INTO v_total FROM public.grn_items WHERE grn_id = p_grn_id;
  UPDATE public.goods_received_notes SET supplier_id = v_supplier,
    unregistered_supplier_name = CASE WHEN v_supplier IS NULL THEN btrim(p_header->>'unregistered_supplier_name') ELSE NULL END,
    weigh_bridge_ticket_id = v_new_ticket, received_date = v_date,
    manual_grv_number = p_header->>'manual_grv_number', notes = p_header->>'notes',
    supplier_invoice_no = p_header->>'supplier_invoice_no', supplier_delivery_note_no = p_header->>'supplier_delivery_note_no',
    supplier_order_no = p_header->>'supplier_order_no', external_reference = p_header->>'external_reference',
    total_value = v_total, status = 'pending_costing', costing_completed_by = NULL, costing_completed_at = NULL,
    updated_at = clock_timestamp() WHERE id = p_grn_id;
  SELECT jsonb_build_object('header', to_jsonb(g), 'lines', (SELECT jsonb_agg(to_jsonb(gi) ORDER BY gi.id)
    FROM public.grn_items gi WHERE gi.grn_id = p_grn_id)) INTO v_after
    FROM public.goods_received_notes g WHERE g.id = p_grn_id;
  INSERT INTO public.grn_correction_audit(grn_id, changed_by, before_data, after_data)
    VALUES (p_grn_id, auth.uid(), v_before, v_after);
END;
$$;
REVOKE ALL ON FUNCTION public.save_grn_correction(uuid, timestamptz, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_grn_correction(uuid, timestamptz, jsonb, jsonb, jsonb) TO authenticated;

-- Keep the RM Manager alias consistent with the correction permission.
CREATE OR REPLACE FUNCTION public.submit_grn_for_finance(p_grn_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_mes_role(ARRAY[
    'admin', 'finance', 'production_receiver', 'supervisor', 'production_manager', 'raw_material_manager', 'rm_manager'
  ]) THEN RAISE EXCEPTION 'You do not have permission to complete GRV costing.'; END IF;
  SELECT status INTO v_status FROM public.goods_received_notes WHERE id = p_grn_id FOR UPDATE;
  IF NOT FOUND OR v_status NOT IN ('pending_costing', 'pending') THEN
    RAISE EXCEPTION 'Only GRVs awaiting costing can be submitted to Finance.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.grn_items WHERE grn_id = p_grn_id)
    OR EXISTS (SELECT 1 FROM public.grn_items WHERE grn_id = p_grn_id
      AND (unit_cost IS NULL OR unit_cost <= 0 OR unit_cost::text IN ('NaN', 'Infinity', '-Infinity'))) THEN
    RAISE EXCEPTION 'Every GRV line needs a positive unit cost before Finance review.';
  END IF;
  UPDATE public.goods_received_notes SET status = 'pending_finance', costing_completed_by = auth.uid(),
    costing_completed_at = now(), updated_at = now() WHERE id = p_grn_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_grn_for_finance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_grn_for_finance(uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
