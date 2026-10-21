-- Schema/functions only: no receipt approval, stock movement, or Sage posting.
BEGIN;
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
COMMIT;
