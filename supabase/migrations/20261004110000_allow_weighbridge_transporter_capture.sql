-- Transporter segregation of duties.
-- Weighbridge may capture the operational transporter selected for a delivery,
-- but receives only a restricted list. Sage account mappings, claims, payments,
-- and reconciliation remain unavailable outside Raw Materials and Admin.

CREATE OR REPLACE FUNCTION public.list_inbound_transporters_for_weighbridge()
RETURNS TABLE (
  id uuid,
  transporter_code text,
  name text,
  default_currency text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager', 'weighbridge', 'weigh_bridge']) THEN
    RAISE EXCEPTION 'Only Weighbridge, Raw Materials, or Admin may view the operational transporter list.';
  END IF;

  RETURN QUERY
  SELECT t.id, t.transporter_code, t.name, t.default_currency
  FROM public.inbound_transporters t
  WHERE t.is_active
  ORDER BY t.name;
END;
$$;

REVOKE ALL ON FUNCTION public.list_inbound_transporters_for_weighbridge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_inbound_transporters_for_weighbridge() TO authenticated;

-- Allow delivery capture only. This does not grant access to transporter
-- accounts, claims, imported Sage entries, allocations, or reconciliation.
CREATE OR REPLACE FUNCTION public.guard_weighbridge_hired_transport_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager', 'weighbridge', 'weigh_bridge']) AND (
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
    RAISE EXCEPTION 'Only Weighbridge, Raw Materials, or Admin may record company-hired inbound transport details.';
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
