-- LIVE ONLY: nxlhgpqtmgixhazihapz (not appyuqxetlphuxfybmus UAT).
-- Apply this ENTIRE file in Supabase SQL Editor. Schema/functions only.
-- Does not correct receipt data, approve GRVs, move stock, or post to Sage.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Source: 20261020120000_atomic_grn_corrections.sql
-- Schema change only: enables audited pre-approval correction; does not edit receipts or post to Sage.


CREATE TABLE IF NOT EXISTS public.grn_correction_audit (
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
DROP POLICY IF EXISTS "Managers can read GRV correction history" ON public.grn_correction_audit;
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



-- Source: 20261020133000_allow_empty_draft_grn_recovery.sql
-- Schema-only follow-up: permit authorised recovery of genuinely empty unapproved GRV drafts.
-- Does not insert receipt lines, edit live GRVs, approve or queue any Sage posting.


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
  IF coalesce(v_saved_lines, '[]'::jsonb) IS DISTINCT FROM coalesce(v_expected_lines, '[]'::jsonb) THEN
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

NOTIFY pgrst, 'reload schema';




-- Source: 20261021110000_flat_grv_transport_and_editor_access.sql
-- Schema/functions only: no receipt approval, stock movement, or Sage posting.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.inbound_transport_claims ADD COLUMN IF NOT EXISTS pricing_basis text
  NOT NULL DEFAULT 'per_tonne' CHECK (pricing_basis IN ('per_tonne', 'flat'));

-- A role-checked snapshot distinguishes genuinely empty drafts from RLS-hidden lines.
CREATE OR REPLACE FUNCTION public.get_grn_correction(p_grn_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_mes_role(ARRAY[
    'admin', 'finance', 'accountant', 'raw_material_manager', 'rm_manager',
    'warehouse_manager', 'production_manager'
  ]) THEN RAISE EXCEPTION 'You do not have permission to edit GRVs.'; END IF;
  SELECT jsonb_build_object('header', to_jsonb(g), 'lines', coalesce((
    SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.grn_items i WHERE i.grn_id = g.id
  ), '[]'::jsonb)) INTO v_result FROM public.goods_received_notes g WHERE g.id = p_grn_id;
  IF v_result IS NULL THEN RAISE EXCEPTION 'GRV not found.'; END IF;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.get_grn_correction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_grn_correction(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_grn_transport_detail_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text; v_approved_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.pricing_basis, NEW.rate_per_tonne, NEW.currency_code, NEW.invoice_number,
      NEW.waybill_reference, NEW.notes, NEW.calculated_amount, NEW.transporter_id,
      NEW.net_mass_kg, NEW.grn_id, NEW.weigh_bridge_ticket_id)
      IS NOT DISTINCT FROM ROW(OLD.pricing_basis, OLD.rate_per_tonne, OLD.currency_code, OLD.invoice_number,
      OLD.waybill_reference, OLD.notes, OLD.calculated_amount, OLD.transporter_id,
      OLD.net_mass_kg, OLD.grn_id, OLD.weigh_bridge_ticket_id) THEN RETURN NEW; END IF;
    IF OLD.status NOT IN ('draft', 'rejected') THEN
      RAISE EXCEPTION 'Transport details are locked after the freight claim is submitted.';
    END IF;
    IF ROW(NEW.transporter_id, NEW.net_mass_kg, NEW.grn_id, NEW.weigh_bridge_ticket_id)
      IS DISTINCT FROM ROW(OLD.transporter_id, OLD.net_mass_kg, OLD.grn_id, OLD.weigh_bridge_ticket_id) THEN
      RAISE EXCEPTION 'The linked transporter and weighbridge evidence cannot be changed.';
    END IF;
  END IF;
  SELECT status, approved_at INTO v_status, v_approved_at FROM public.goods_received_notes WHERE id = NEW.grn_id FOR UPDATE;
  IF NOT FOUND OR v_approved_at IS NOT NULL OR coalesce(v_status, '') NOT IN ('pending', 'pending_costing', 'pending_finance') THEN
    RAISE EXCEPTION 'Transport details are locked after GRN approval.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sync_log WHERE reference_id = NEW.grn_id AND event_type = 'grn_confirmed') THEN
    RAISE EXCEPTION 'This GRV has Sage queue history. Reconcile it before correcting.';
  END IF;
  IF NEW.currency_code NOT IN ('USD', 'ZIG', 'ZAR')
    OR NEW.calculated_amount IS NULL OR NEW.calculated_amount <= 0
    OR NEW.calculated_amount::text IN ('NaN', 'Infinity', '-Infinity')
    OR (NEW.pricing_basis = 'per_tonne' AND (NEW.rate_per_tonne IS NULL OR NEW.rate_per_tonne <= 0
      OR NEW.rate_per_tonne::text IN ('NaN', 'Infinity', '-Infinity')))
    OR (NEW.pricing_basis = 'flat' AND NEW.rate_per_tonne IS DISTINCT FROM 0::numeric) THEN
    RAISE EXCEPTION 'Enter a positive transport amount and a supported currency.';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_guard_grn_transport_detail_edit ON public.inbound_transport_claims;
CREATE TRIGGER trg_guard_grn_transport_detail_edit
  BEFORE INSERT OR UPDATE ON public.inbound_transport_claims
  FOR EACH ROW EXECUTE FUNCTION public.guard_grn_transport_detail_edit();

CREATE OR REPLACE FUNCTION public.audit_grn_transport_detail_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF ROW(NEW.pricing_basis, NEW.calculated_amount, NEW.rate_per_tonne, NEW.currency_code,
    NEW.invoice_number, NEW.waybill_reference, NEW.notes)
    IS DISTINCT FROM ROW(OLD.pricing_basis, OLD.calculated_amount, OLD.rate_per_tonne, OLD.currency_code,
    OLD.invoice_number, OLD.waybill_reference, OLD.notes) THEN
    INSERT INTO public.inbound_transport_claim_history(claim_id, action, from_status, to_status, note, changed_by)
    VALUES (NEW.id, 'details_updated', OLD.status, NEW.status,
      jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW))::text, auth.uid());
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_audit_grn_transport_detail_edit ON public.inbound_transport_claims;
CREATE TRIGGER trg_audit_grn_transport_detail_edit
  AFTER UPDATE ON public.inbound_transport_claims
  FOR EACH ROW EXECUTE FUNCTION public.audit_grn_transport_detail_edit();

CREATE OR REPLACE FUNCTION public.save_inbound_transport_flat_claim(
  p_claim_id uuid, p_weigh_bridge_ticket_id uuid, p_transporter_id uuid,
  p_transport_amount numeric, p_currency_code text, p_invoice_number text,
  p_waybill_reference text, p_notes text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ticket public.weigh_bridge_tickets%ROWTYPE;
  v_grn public.goods_received_notes%ROWTYPE;
  v_existing public.inbound_transport_claims%ROWTYPE; v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']) THEN
    RAISE EXCEPTION 'Only Raw Materials Manager or Admin can record transport costs.';
  END IF;
  IF p_transport_amount IS NULL OR p_transport_amount <= 0 OR round(p_transport_amount, 2) <= 0
    OR p_transport_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'A positive flat transport amount is required.';
  END IF;
  -- Same GRN -> ticket -> claim lock order as receipt corrections.
  SELECT * INTO v_grn FROM public.goods_received_notes
    WHERE weigh_bridge_ticket_id = p_weigh_bridge_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_grn.status NOT IN ('pending', 'pending_costing', 'pending_finance')
    OR v_grn.approved_at IS NOT NULL THEN RAISE EXCEPTION 'Transport details are locked after GRN approval.'; END IF;
  IF EXISTS (SELECT 1 FROM public.sync_log WHERE reference_id = v_grn.id AND event_type = 'grn_confirmed') THEN
    RAISE EXCEPTION 'This GRV has Sage queue history. Reconcile it before correcting.';
  END IF;
  SELECT * INTO v_ticket FROM public.weigh_bridge_tickets WHERE id = p_weigh_bridge_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_ticket.inbound_transport_mode <> 'company_hired'
    OR NOT coalesce(v_ticket.driver_signed, false) OR coalesce(v_ticket.nett_mass, 0) <= 0 THEN
    RAISE EXCEPTION 'A signed company-hired ticket with positive net mass is required.';
  END IF;
  IF p_transporter_id IS DISTINCT FROM v_ticket.inbound_transporter_id OR NOT EXISTS (
    SELECT 1 FROM public.inbound_transporters WHERE id = p_transporter_id AND is_active
  ) THEN RAISE EXCEPTION 'Use the active transporter selected at the weighbridge.'; END IF;
  SELECT * INTO v_existing FROM public.inbound_transport_claims WHERE grn_id = v_grn.id FOR UPDATE;
  IF FOUND THEN
    IF p_claim_id IS DISTINCT FROM v_existing.id THEN RAISE EXCEPTION 'Transport claim changed. Reopen the GRV.'; END IF;
    IF v_existing.status NOT IN ('draft', 'rejected') THEN
      RAISE EXCEPTION 'Only draft or rejected transport claims can be changed.';
    END IF;
    UPDATE public.inbound_transport_claims SET pricing_basis = 'flat', rate_per_tonne = 0,
      calculated_amount = round(p_transport_amount, 2), currency_code = upper(p_currency_code),
      invoice_number = nullif(btrim(p_invoice_number), ''), waybill_reference = nullif(btrim(p_waybill_reference), ''),
      notes = coalesce(nullif(btrim(p_notes), ''), notes), review_note = NULL, updated_at = clock_timestamp()
      WHERE id = v_existing.id RETURNING id INTO v_id;
  ELSE
    IF p_claim_id IS NOT NULL THEN RAISE EXCEPTION 'Transport claim changed. Reopen the GRV.'; END IF;
    INSERT INTO public.inbound_transport_claims(claim_number, weigh_bridge_ticket_id, grn_id,
      transporter_id, net_mass_kg, pricing_basis, rate_per_tonne, calculated_amount, currency_code,
      invoice_number, waybill_reference, notes, created_by)
    VALUES (public.next_inbound_transport_claim_number(), v_ticket.id, v_grn.id, p_transporter_id,
      v_ticket.nett_mass, 'flat', 0, round(p_transport_amount, 2), upper(p_currency_code),
      nullif(btrim(p_invoice_number), ''), nullif(btrim(p_waybill_reference), ''),
      coalesce(nullif(btrim(p_notes), ''), 'Flat transport amount recorded on GRV.'), auth.uid()) RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.save_inbound_transport_flat_claim(uuid, uuid, uuid, numeric, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_inbound_transport_flat_claim(uuid, uuid, uuid, numeric, text, text, text, text) TO authenticated;
NOTIFY pgrst, 'reload schema';



-- Source: 20261021150000_rm_transport_cost_guard_permissions.sql
-- LIVE: nxlhgpqtmgixhazihapz. Repairs legacy Admin-only guards; no receipt/stock/Sage writes.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.guard_inbound_transport_claim_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.has_mes_role(ARRAY[
    'admin', 'raw_material_manager', 'rm_manager'
  ]), false) THEN
    RAISE EXCEPTION 'Only Raw Materials Manager or Admin may record or update inbound transport costs.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF NOT public.has_mes_role(ARRAY['admin']) THEN
      RAISE EXCEPTION 'Only Admin may delete transport claims.' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_guard_inbound_transport_claim_admin ON public.inbound_transport_claims;
CREATE TRIGGER trg_guard_inbound_transport_claim_admin
  BEFORE INSERT OR UPDATE OR DELETE ON public.inbound_transport_claims
  FOR EACH ROW EXECUTE FUNCTION public.guard_inbound_transport_claim_admin();

DROP POLICY IF EXISTS inbound_transporters_read ON public.inbound_transporters;
CREATE POLICY inbound_transporters_read ON public.inbound_transporters FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));
DROP POLICY IF EXISTS inbound_transport_claims_read ON public.inbound_transport_claims;
CREATE POLICY inbound_transport_claims_read ON public.inbound_transport_claims FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));
DROP POLICY IF EXISTS inbound_transport_claim_history_read ON public.inbound_transport_claim_history;
CREATE POLICY inbound_transport_claim_history_read ON public.inbound_transport_claim_history FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));

-- Keep the existing flat-cost validation, approval/queue locks and audit triggers.
GRANT EXECUTE ON FUNCTION public.save_inbound_transport_flat_claim(uuid, uuid, uuid, numeric, text, text, text, text) TO authenticated;
NOTIFY pgrst, 'reload schema';



COMMIT;
