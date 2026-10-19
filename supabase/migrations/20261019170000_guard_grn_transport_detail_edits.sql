-- Preserve gate evidence and approved costs, including writes outside the GRN UI.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.guard_grn_transport_detail_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text; v_changed boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_changed := ROW(NEW.rate_per_tonne, NEW.currency_code, NEW.invoice_number,
      NEW.waybill_reference, NEW.notes, NEW.calculated_amount, NEW.transporter_id,
      NEW.net_mass_kg, NEW.grn_id, NEW.weigh_bridge_ticket_id)
      IS DISTINCT FROM ROW(OLD.rate_per_tonne, OLD.currency_code, OLD.invoice_number,
      OLD.waybill_reference, OLD.notes, OLD.calculated_amount, OLD.transporter_id,
      OLD.net_mass_kg, OLD.grn_id, OLD.weigh_bridge_ticket_id);
    IF NOT v_changed THEN RETURN NEW; END IF;
    IF OLD.status NOT IN ('draft', 'rejected') THEN
      RAISE EXCEPTION 'Transport details are locked after the freight claim is submitted.';
    END IF;
    IF ROW(NEW.transporter_id, NEW.net_mass_kg, NEW.grn_id, NEW.weigh_bridge_ticket_id)
      IS DISTINCT FROM ROW(OLD.transporter_id, OLD.net_mass_kg, OLD.grn_id, OLD.weigh_bridge_ticket_id) THEN
      RAISE EXCEPTION 'The linked transporter and weighbridge evidence cannot be changed.';
    END IF;
  END IF;
  SELECT status INTO v_status FROM public.goods_received_notes WHERE id = NEW.grn_id FOR UPDATE;
  IF NOT FOUND OR coalesce(v_status, '') NOT IN ('pending', 'pending_costing', 'pending_finance') THEN
    RAISE EXCEPTION 'Transport details are locked after GRN approval.';
  END IF;
  IF NEW.rate_per_tonne IS NULL OR NEW.rate_per_tonne <= 0
     OR NEW.currency_code NOT IN ('USD', 'ZIG', 'ZAR') THEN
    RAISE EXCEPTION 'Enter a positive transport rate and a supported currency.';
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
  IF ROW(NEW.rate_per_tonne, NEW.currency_code, NEW.invoice_number, NEW.waybill_reference, NEW.notes)
     IS DISTINCT FROM ROW(OLD.rate_per_tonne, OLD.currency_code, OLD.invoice_number, OLD.waybill_reference, OLD.notes) THEN
    INSERT INTO public.inbound_transport_claim_history(claim_id, action, from_status, to_status, note, changed_by)
    VALUES (NEW.id, 'details_updated', OLD.status, NEW.status,
      jsonb_build_object(
        'before', jsonb_build_object('rate', OLD.rate_per_tonne, 'currency', OLD.currency_code,
          'invoice', OLD.invoice_number, 'waybill', OLD.waybill_reference, 'notes', OLD.notes),
        'after', jsonb_build_object('rate', NEW.rate_per_tonne, 'currency', NEW.currency_code,
          'invoice', NEW.invoice_number, 'waybill', NEW.waybill_reference, 'notes', NEW.notes)
      )::text, auth.uid());
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_audit_grn_transport_detail_edit ON public.inbound_transport_claims;
CREATE TRIGGER trg_audit_grn_transport_detail_edit
  AFTER UPDATE ON public.inbound_transport_claims
  FOR EACH ROW EXECUTE FUNCTION public.audit_grn_transport_detail_edit();

NOTIFY pgrst, 'reload schema';
COMMIT;
