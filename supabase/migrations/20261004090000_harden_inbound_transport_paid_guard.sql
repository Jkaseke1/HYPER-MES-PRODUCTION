-- A transport claim may only become paid from allocated, imported Sage CBAP
-- evidence. This migration changes PlantControl controls only; it creates no
-- Sage, GRN, supplier, or payment transactions.

-- The original two-argument routine could mark a claim paid from a typed
-- reference. The three-argument stub was introduced later, but did not remove
-- this older overload. Remove both routes completely.
DROP FUNCTION IF EXISTS public.mark_inbound_transport_claim_paid(uuid, text);
DROP FUNCTION IF EXISTS public.mark_inbound_transport_claim_paid(uuid, text, text);

CREATE OR REPLACE FUNCTION public.guard_inbound_transport_paid_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid_total numeric(18,2);
  v_payment_reference text;
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    SELECT coalesce(sum(allocated_amount), 0)
      INTO v_paid_total
    FROM public.inbound_transport_sage_payment_allocations
    WHERE claim_id = NEW.id;

    IF v_paid_total < NEW.calculated_amount - 0.01 THEN
      RAISE EXCEPTION
        'A transport claim cannot be marked paid until imported Sage payment allocations cover its full value.';
    END IF;

    SELECT string_agg(h.reference || ' / ' || h.audit_number, ', ' ORDER BY h.transaction_date, h.audit_number)
      INTO v_payment_reference
    FROM public.inbound_transport_sage_payment_allocations a
    JOIN public.inbound_transport_sage_history h ON h.id = a.sage_history_id
    WHERE a.claim_id = NEW.id;

    NEW.payment_reference := v_payment_reference;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_inbound_transport_paid_status
  ON public.inbound_transport_claims;
CREATE TRIGGER trg_guard_inbound_transport_paid_status
  BEFORE UPDATE OF status ON public.inbound_transport_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_inbound_transport_paid_status();

REVOKE ALL ON FUNCTION public.guard_inbound_transport_paid_status() FROM PUBLIC;
NOTIFY pgrst, 'reload schema';
