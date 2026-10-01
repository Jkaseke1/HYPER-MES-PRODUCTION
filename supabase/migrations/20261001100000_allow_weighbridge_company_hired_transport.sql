-- Weighbridge operators must identify the transport source at the gate.
-- They may select an approved carrier and capture the agreed haulage rate on
-- their ticket, but cannot maintain carriers/rates or approve/pay claims.

DROP POLICY IF EXISTS inbound_transporters_read ON public.inbound_transporters;
CREATE POLICY inbound_transporters_read ON public.inbound_transporters
  FOR SELECT TO authenticated
  USING (
    public.has_mes_role(ARRAY['admin'])
    OR (
      public.has_mes_role(ARRAY['weighbridge'])
      AND is_active = true
    )
  );

DROP POLICY IF EXISTS inbound_transporter_rate_cards_admin_only ON public.inbound_transporter_rate_cards;
DROP POLICY IF EXISTS inbound_transporter_rate_cards_read ON public.inbound_transporter_rate_cards;
DROP POLICY IF EXISTS inbound_transporter_rate_cards_manage ON public.inbound_transporter_rate_cards;

CREATE POLICY inbound_transporter_rate_cards_read ON public.inbound_transporter_rate_cards
  FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'weighbridge']));

CREATE POLICY inbound_transporter_rate_cards_manage ON public.inbound_transporter_rate_cards
  FOR ALL TO authenticated
  USING (public.has_mes_role(ARRAY['admin']))
  WITH CHECK (public.has_mes_role(ARRAY['admin']));

CREATE OR REPLACE FUNCTION public.guard_weighbridge_hired_transport_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'weighbridge']) AND (
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
    RAISE EXCEPTION 'Only a Weighbridge Operator or Admin may record company-hired inbound transport details.';
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
