-- Inbound transport costs are a PlantControl Admin-only function for now.
-- This deliberately has no Sage posting, stock, GRN approval, or creditor impact.

DROP POLICY IF EXISTS inbound_transporters_read ON public.inbound_transporters;
DROP POLICY IF EXISTS inbound_transporters_manage ON public.inbound_transporters;
DROP POLICY IF EXISTS inbound_transport_claims_read ON public.inbound_transport_claims;
DROP POLICY IF EXISTS inbound_transport_claim_history_read ON public.inbound_transport_claim_history;

CREATE POLICY inbound_transporters_read ON public.inbound_transporters
  FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin']));
CREATE POLICY inbound_transporters_manage ON public.inbound_transporters
  FOR ALL TO authenticated
  USING (public.has_mes_role(ARRAY['admin']))
  WITH CHECK (public.has_mes_role(ARRAY['admin']));
CREATE POLICY inbound_transport_claims_read ON public.inbound_transport_claims
  FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin']));
CREATE POLICY inbound_transport_claim_history_read ON public.inbound_transport_claim_history
  FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin']));

CREATE OR REPLACE FUNCTION public.guard_weighbridge_hired_transport_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin']) AND (
    TG_OP = 'INSERT' AND NEW.inbound_transport_mode = 'company_hired'
    OR TG_OP = 'UPDATE' AND (
      NEW.inbound_transport_mode IS DISTINCT FROM OLD.inbound_transport_mode
      OR NEW.inbound_transporter_id IS DISTINCT FROM OLD.inbound_transporter_id
      OR NEW.inbound_rate_per_tonne IS DISTINCT FROM OLD.inbound_rate_per_tonne
      OR NEW.inbound_currency_code IS DISTINCT FROM OLD.inbound_currency_code
      OR NEW.inbound_invoice_number IS DISTINCT FROM OLD.inbound_invoice_number
      OR NEW.inbound_waybill_reference IS DISTINCT FROM OLD.inbound_waybill_reference
      OR NEW.inbound_transport_notes IS DISTINCT FROM OLD.inbound_transport_notes
    )
  ) THEN
    RAISE EXCEPTION 'Only Admin may record or change company-hired inbound transport details.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_weighbridge_hired_transport_admin ON public.weigh_bridge_tickets;
CREATE TRIGGER trg_guard_weighbridge_hired_transport_admin
  BEFORE INSERT OR UPDATE OF inbound_transport_mode, inbound_transporter_id, inbound_rate_per_tonne,
    inbound_currency_code, inbound_invoice_number, inbound_waybill_reference, inbound_transport_notes
  ON public.weigh_bridge_tickets
  FOR EACH ROW EXECUTE FUNCTION public.guard_weighbridge_hired_transport_admin();

CREATE OR REPLACE FUNCTION public.guard_inbound_transport_claim_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The GRN trigger creates the one draft claim for an Admin-recorded hired
  -- ticket. Allow that system-generated insert even when a warehouse operator
  -- records the GRN; all later claim work remains Admin-only.
  IF TG_OP = 'INSERT' AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NOT public.has_mes_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Inbound transport claims are currently Admin-only.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_inbound_transport_claim_admin ON public.inbound_transport_claims;
CREATE TRIGGER trg_guard_inbound_transport_claim_admin
  BEFORE INSERT OR UPDATE OR DELETE ON public.inbound_transport_claims
  FOR EACH ROW EXECUTE FUNCTION public.guard_inbound_transport_claim_admin();

NOTIFY pgrst, 'reload schema';
