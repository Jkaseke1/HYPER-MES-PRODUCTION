-- Transport ownership is recorded at the weighbridge. Supplier-provided arrivals
-- never create a company freight liability. A company-hired arrival creates one
-- immutable-cost draft claim when its GRN is saved.

ALTER TABLE public.weigh_bridge_tickets
  ADD COLUMN IF NOT EXISTS inbound_transport_mode text NOT NULL DEFAULT 'supplier_provided',
  ADD COLUMN IF NOT EXISTS inbound_transporter_id uuid REFERENCES public.inbound_transporters(id),
  ADD COLUMN IF NOT EXISTS inbound_rate_per_tonne numeric(14,4),
  ADD COLUMN IF NOT EXISTS inbound_currency_code text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS inbound_invoice_number text,
  ADD COLUMN IF NOT EXISTS inbound_waybill_reference text,
  ADD COLUMN IF NOT EXISTS inbound_transport_notes text NOT NULL DEFAULT '';

ALTER TABLE public.weigh_bridge_tickets
  DROP CONSTRAINT IF EXISTS weigh_bridge_tickets_inbound_transport_check;

ALTER TABLE public.weigh_bridge_tickets
  ADD CONSTRAINT weigh_bridge_tickets_inbound_transport_check
  CHECK (
    inbound_transport_mode IN ('supplier_provided', 'company_hired')
    AND (
      inbound_transport_mode = 'supplier_provided'
      OR (
        inbound_transporter_id IS NOT NULL
        AND inbound_rate_per_tonne IS NOT NULL
        AND inbound_rate_per_tonne > 0
      )
    )
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.create_hired_inbound_transport_claim_from_grn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.weigh_bridge_tickets%ROWTYPE;
BEGIN
  IF NEW.weigh_bridge_ticket_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.weigh_bridge_ticket_id IS NOT DISTINCT FROM OLD.weigh_bridge_ticket_id THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_ticket
  FROM public.weigh_bridge_tickets
  WHERE id = NEW.weigh_bridge_ticket_id;

  IF NOT FOUND OR v_ticket.inbound_transport_mode <> 'company_hired' THEN
    RETURN NEW;
  END IF;

  IF NOT coalesce(v_ticket.driver_signed, false)
    OR coalesce(v_ticket.nett_mass, 0) <= 0
    OR v_ticket.inbound_transporter_id IS NULL
    OR coalesce(v_ticket.inbound_rate_per_tonne, 0) <= 0 THEN
    RAISE EXCEPTION 'Company-hired transport requires a signed ticket, active transporter, and positive agreed rate.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inbound_transporters
    WHERE id = v_ticket.inbound_transporter_id AND is_active
  ) THEN
    RAISE EXCEPTION 'The company-hired transporter on this weighbridge ticket is no longer active.';
  END IF;

  INSERT INTO public.inbound_transport_claims (
    claim_number, weigh_bridge_ticket_id, grn_id, transporter_id, net_mass_kg,
    rate_per_tonne, calculated_amount, currency_code, invoice_number,
    waybill_reference, notes, created_by
  ) VALUES (
    public.next_inbound_transport_claim_number(), v_ticket.id, NEW.id,
    v_ticket.inbound_transporter_id, v_ticket.nett_mass, v_ticket.inbound_rate_per_tonne,
    round((v_ticket.nett_mass / 1000) * v_ticket.inbound_rate_per_tonne, 2),
    upper(coalesce(nullif(btrim(v_ticket.inbound_currency_code), ''), 'USD')),
    nullif(btrim(v_ticket.inbound_invoice_number), ''),
    nullif(btrim(v_ticket.inbound_waybill_reference), ''),
    coalesce(nullif(btrim(v_ticket.inbound_transport_notes), ''), 'Company-hired transport captured at weighbridge.'),
    COALESCE(NEW.received_by, auth.uid())
  ) ON CONFLICT (weigh_bridge_ticket_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_hired_inbound_transport_claim_from_grn ON public.goods_received_notes;
CREATE TRIGGER trg_create_hired_inbound_transport_claim_from_grn
  AFTER INSERT OR UPDATE OF weigh_bridge_ticket_id ON public.goods_received_notes
  FOR EACH ROW EXECUTE FUNCTION public.create_hired_inbound_transport_claim_from_grn();

-- Even a direct database/API call cannot attach a supplier-provided ticket to a
-- company cost, or replace the transporter/rate agreed at the gate.
CREATE OR REPLACE FUNCTION public.guard_inbound_transport_claim_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.weigh_bridge_tickets%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.transporter_id IS NOT DISTINCT FROM OLD.transporter_id
    AND NEW.rate_per_tonne IS NOT DISTINCT FROM OLD.rate_per_tonne THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_ticket
  FROM public.weigh_bridge_tickets
  WHERE id = NEW.weigh_bridge_ticket_id;

  IF NOT FOUND OR v_ticket.inbound_transport_mode <> 'company_hired' THEN
    RAISE EXCEPTION 'Only company-hired weighbridge tickets may create an inbound transport claim.';
  END IF;

  IF NEW.transporter_id IS DISTINCT FROM v_ticket.inbound_transporter_id
    OR NEW.rate_per_tonne IS DISTINCT FROM v_ticket.inbound_rate_per_tonne THEN
    RAISE EXCEPTION 'Transporter and rate must match the company-hired details recorded at the weighbridge.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_inbound_transport_claim_source ON public.inbound_transport_claims;
CREATE TRIGGER trg_guard_inbound_transport_claim_source
  BEFORE INSERT OR UPDATE OF transporter_id, rate_per_tonne ON public.inbound_transport_claims
  FOR EACH ROW EXECUTE FUNCTION public.guard_inbound_transport_claim_source();

NOTIFY pgrst, 'reload schema';
