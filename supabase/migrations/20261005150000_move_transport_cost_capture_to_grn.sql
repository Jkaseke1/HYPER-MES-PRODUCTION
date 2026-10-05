-- Segregate operational gate capture from commercial transport costing.
-- Weighbridge identifies the transport source and transporter only. The Raw
-- Materials Manager creates the cost benchmark while saving the linked GRN.

ALTER TABLE public.weigh_bridge_tickets
  DROP CONSTRAINT IF EXISTS weigh_bridge_tickets_inbound_transport_check;

ALTER TABLE public.weigh_bridge_tickets
  ADD CONSTRAINT weigh_bridge_tickets_inbound_transport_check
  CHECK (
    inbound_transport_mode IN ('supplier_provided', 'company_hired')
    AND (
      inbound_transport_mode = 'supplier_provided'
      OR inbound_transporter_id IS NOT NULL
    )
  ) NOT VALID;

-- A GRN link is evidence only. It must not manufacture a financial claim from
-- incomplete gate data.
CREATE OR REPLACE FUNCTION public.create_hired_inbound_transport_claim_from_grn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NEW;
END;
$$;

-- Preserve the operational transporter chosen at the gate, but permit the
-- authorised Raw Materials claim workflow to supply its commercial terms.
CREATE OR REPLACE FUNCTION public.guard_inbound_transport_claim_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.weigh_bridge_tickets%ROWTYPE;
BEGIN
  SELECT * INTO v_ticket
  FROM public.weigh_bridge_tickets
  WHERE id = NEW.weigh_bridge_ticket_id;

  IF NOT FOUND OR v_ticket.inbound_transport_mode <> 'company_hired' THEN
    RAISE EXCEPTION 'Only company-hired weighbridge tickets may create an inbound transport claim.';
  END IF;

  IF NEW.transporter_id IS DISTINCT FROM v_ticket.inbound_transporter_id THEN
    RAISE EXCEPTION 'Transporter must match the company-hired transporter selected at the weighbridge.';
  END IF;

  RETURN NEW;
END;
$$;

-- The claim RPC is the sole commercial handoff. It creates the expected
-- amount from signed mass and the Raw Materials Manager's rate; it never
-- posts or pays anything in Sage.
CREATE OR REPLACE FUNCTION public.save_inbound_transport_claim(
  p_claim_id uuid,
  p_weigh_bridge_ticket_id uuid,
  p_transporter_id uuid,
  p_rate_per_tonne numeric,
  p_currency_code text,
  p_invoice_number text,
  p_waybill_reference text,
  p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.weigh_bridge_tickets%ROWTYPE;
  v_grn_id uuid;
  v_existing public.inbound_transport_claims%ROWTYPE;
  v_claim_id uuid;
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']) THEN
    RAISE EXCEPTION 'Only the Raw Materials Manager or Admin can record an inbound transport cost.';
  END IF;
  IF p_rate_per_tonne IS NULL OR p_rate_per_tonne <= 0 THEN
    RAISE EXCEPTION 'A positive agreed rate per tonne is required.';
  END IF;

  SELECT * INTO v_ticket FROM public.weigh_bridge_tickets
  WHERE id = p_weigh_bridge_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_ticket.inbound_transport_mode <> 'company_hired'
    OR NOT coalesce(v_ticket.driver_signed, false) OR coalesce(v_ticket.nett_mass, 0) <= 0 THEN
    RAISE EXCEPTION 'A signed company-hired weighbridge ticket with positive net mass is required.';
  END IF;
  IF p_transporter_id IS DISTINCT FROM v_ticket.inbound_transporter_id THEN
    RAISE EXCEPTION 'The GRN transport claim must use the transporter selected at the weighbridge.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inbound_transporters WHERE id = p_transporter_id AND is_active) THEN
    RAISE EXCEPTION 'The selected transporter is not active.';
  END IF;
  SELECT id INTO v_grn_id FROM public.goods_received_notes WHERE weigh_bridge_ticket_id = p_weigh_bridge_ticket_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link the weighbridge ticket to a GRN first.'; END IF;

  IF p_claim_id IS NULL THEN
    INSERT INTO public.inbound_transport_claims (
      claim_number, weigh_bridge_ticket_id, grn_id, transporter_id, net_mass_kg,
      rate_per_tonne, calculated_amount, currency_code, invoice_number,
      waybill_reference, notes, created_by
    ) VALUES (
      public.next_inbound_transport_claim_number(), p_weigh_bridge_ticket_id, v_grn_id,
      p_transporter_id, v_ticket.nett_mass, p_rate_per_tonne,
      round((v_ticket.nett_mass / 1000) * p_rate_per_tonne, 2),
      upper(coalesce(nullif(btrim(p_currency_code), ''), 'USD')),
      nullif(btrim(p_invoice_number), ''), nullif(btrim(p_waybill_reference), ''),
      coalesce(nullif(btrim(p_notes), ''), 'Cost details recorded by Raw Materials Manager on the GRN.'), auth.uid()
    ) RETURNING id INTO v_claim_id;
  ELSE
    SELECT * INTO v_existing FROM public.inbound_transport_claims WHERE id = p_claim_id FOR UPDATE;
    IF NOT FOUND OR v_existing.status NOT IN ('draft', 'rejected') THEN
      RAISE EXCEPTION 'Only draft or rejected transport claims can be changed.';
    END IF;
    IF v_existing.weigh_bridge_ticket_id <> p_weigh_bridge_ticket_id THEN
      RAISE EXCEPTION 'The evidence ticket cannot be changed.';
    END IF;
    UPDATE public.inbound_transport_claims SET
      rate_per_tonne = p_rate_per_tonne,
      calculated_amount = round((v_ticket.nett_mass / 1000) * p_rate_per_tonne, 2),
      currency_code = upper(coalesce(nullif(btrim(p_currency_code), ''), 'USD')),
      invoice_number = nullif(btrim(p_invoice_number), ''),
      waybill_reference = nullif(btrim(p_waybill_reference), ''),
      notes = coalesce(nullif(btrim(p_notes), ''), notes), review_note = NULL, updated_at = now()
    WHERE id = p_claim_id;
    v_claim_id := p_claim_id;
  END IF;
  RETURN v_claim_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_inbound_transport_claim(uuid, uuid, uuid, numeric, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_inbound_transport_claim(uuid, uuid, uuid, numeric, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
