-- Delivery-level transport reconciliation. Sage remains read-only: Admin links
-- imported PostAP evidence to the PlantControl claim created from a signed
-- company-hired weighbridge ticket and its GRN.

DROP INDEX IF EXISTS public.uq_inbound_transport_claims_sage_payment_audit;

CREATE TABLE IF NOT EXISTS public.inbound_transport_sage_charge_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.inbound_transport_claims(id) ON DELETE CASCADE,
  sage_history_id uuid NOT NULL REFERENCES public.inbound_transport_sage_history(id) ON DELETE RESTRICT,
  allocated_amount numeric(18,2) NOT NULL CHECK (allocated_amount > 0),
  allocated_by uuid REFERENCES auth.users(id),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (claim_id, sage_history_id)
);

CREATE TABLE IF NOT EXISTS public.inbound_transport_sage_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.inbound_transport_claims(id) ON DELETE CASCADE,
  sage_history_id uuid NOT NULL REFERENCES public.inbound_transport_sage_history(id) ON DELETE RESTRICT,
  allocated_amount numeric(18,2) NOT NULL CHECK (allocated_amount > 0),
  allocated_by uuid REFERENCES auth.users(id),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (claim_id, sage_history_id)
);

CREATE INDEX IF NOT EXISTS idx_inbound_transport_charge_allocation_claim
  ON public.inbound_transport_sage_charge_allocations (claim_id);
CREATE INDEX IF NOT EXISTS idx_inbound_transport_payment_allocation_claim
  ON public.inbound_transport_sage_payment_allocations (claim_id);

ALTER TABLE public.inbound_transport_sage_charge_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_transport_sage_payment_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbound_transport_sage_charge_allocations FROM anon, authenticated;
REVOKE ALL ON public.inbound_transport_sage_payment_allocations FROM anon, authenticated;
GRANT SELECT ON public.inbound_transport_sage_charge_allocations TO authenticated;
GRANT SELECT ON public.inbound_transport_sage_payment_allocations TO authenticated;

DROP POLICY IF EXISTS inbound_transport_charge_allocations_admin_read ON public.inbound_transport_sage_charge_allocations;
CREATE POLICY inbound_transport_charge_allocations_admin_read
  ON public.inbound_transport_sage_charge_allocations FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin']));
DROP POLICY IF EXISTS inbound_transport_payment_allocations_admin_read ON public.inbound_transport_sage_payment_allocations;
CREATE POLICY inbound_transport_payment_allocations_admin_read
  ON public.inbound_transport_sage_payment_allocations FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin']));

CREATE OR REPLACE FUNCTION public.allocate_inbound_transport_sage_entry(
  p_claim_id uuid,
  p_sage_history_id uuid,
  p_allocated_amount numeric,
  p_entry_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim public.inbound_transport_claims%ROWTYPE;
  v_entry public.inbound_transport_sage_history%ROWTYPE;
  v_supplier_account text;
  v_existing_claim_total numeric(18,2);
  v_existing_entry_total numeric(18,2);
  v_current_amount numeric(18,2);
  v_entry_amount numeric(18,2);
  v_paid_total numeric(18,2);
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Only Admin may reconcile imported Sage transport entries.';
  END IF;
  IF p_entry_type NOT IN ('APTx', 'CBAP') OR coalesce(p_allocated_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Choose a Sage charge or payment and enter a positive allocation amount.';
  END IF;

  SELECT * INTO v_claim FROM public.inbound_transport_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR v_claim.status NOT IN ('approved', 'paid') THEN
    RAISE EXCEPTION 'Only an approved transport claim can be reconciled.';
  END IF;
  SELECT sage_supplier_account INTO v_supplier_account
  FROM public.inbound_transporters WHERE id = v_claim.transporter_id AND is_active;
  IF nullif(btrim(v_supplier_account), '') IS NULL THEN
    RAISE EXCEPTION 'This transporter does not have a verified Sage supplier account.';
  END IF;

  SELECT * INTO v_entry FROM public.inbound_transport_sage_history WHERE id = p_sage_history_id FOR UPDATE;
  IF NOT FOUND OR v_entry.transaction_type <> p_entry_type
    OR upper(btrim(v_entry.supplier_account)) <> upper(btrim(v_supplier_account)) THEN
    RAISE EXCEPTION 'The imported Sage entry is not the selected transporter % entry type.', p_entry_type;
  END IF;
  v_entry_amount := CASE WHEN p_entry_type = 'APTx' THEN v_entry.credit - v_entry.debit ELSE v_entry.debit - v_entry.credit END;
  IF v_entry_amount <= 0 THEN
    RAISE EXCEPTION 'The selected Sage entry has no allocatable amount.';
  END IF;

  IF p_entry_type = 'APTx' THEN
    SELECT allocated_amount INTO v_current_amount FROM public.inbound_transport_sage_charge_allocations
    WHERE claim_id = p_claim_id AND sage_history_id = p_sage_history_id;
    SELECT coalesce(sum(allocated_amount), 0) INTO v_existing_claim_total
    FROM public.inbound_transport_sage_charge_allocations WHERE claim_id = p_claim_id;
    SELECT coalesce(sum(allocated_amount), 0) INTO v_existing_entry_total
    FROM public.inbound_transport_sage_charge_allocations WHERE sage_history_id = p_sage_history_id;
    IF v_existing_claim_total - coalesce(v_current_amount, 0) + p_allocated_amount > v_claim.calculated_amount + 0.01
      OR v_existing_entry_total - coalesce(v_current_amount, 0) + p_allocated_amount > v_entry_amount + 0.01 THEN
      RAISE EXCEPTION 'Charge allocation exceeds the available claim or Sage charge value.';
    END IF;
    INSERT INTO public.inbound_transport_sage_charge_allocations (claim_id, sage_history_id, allocated_amount, allocated_by)
    VALUES (p_claim_id, p_sage_history_id, p_allocated_amount, auth.uid())
    ON CONFLICT (claim_id, sage_history_id) DO UPDATE SET
      allocated_amount = EXCLUDED.allocated_amount, allocated_by = EXCLUDED.allocated_by, allocated_at = now();
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.inbound_transport_sage_charge_allocations WHERE claim_id = p_claim_id) THEN
      RAISE EXCEPTION 'Match a Sage charge to this delivery before allocating a Sage payment.';
    END IF;
    SELECT allocated_amount INTO v_current_amount FROM public.inbound_transport_sage_payment_allocations
    WHERE claim_id = p_claim_id AND sage_history_id = p_sage_history_id;
    SELECT coalesce(sum(allocated_amount), 0) INTO v_existing_claim_total
    FROM public.inbound_transport_sage_payment_allocations WHERE claim_id = p_claim_id;
    SELECT coalesce(sum(allocated_amount), 0) INTO v_existing_entry_total
    FROM public.inbound_transport_sage_payment_allocations WHERE sage_history_id = p_sage_history_id;
    IF v_existing_claim_total - coalesce(v_current_amount, 0) + p_allocated_amount > v_claim.calculated_amount + 0.01
      OR v_existing_entry_total - coalesce(v_current_amount, 0) + p_allocated_amount > v_entry_amount + 0.01 THEN
      RAISE EXCEPTION 'Payment allocation exceeds the available claim or Sage payment value.';
    END IF;
    INSERT INTO public.inbound_transport_sage_payment_allocations (claim_id, sage_history_id, allocated_amount, allocated_by)
    VALUES (p_claim_id, p_sage_history_id, p_allocated_amount, auth.uid())
    ON CONFLICT (claim_id, sage_history_id) DO UPDATE SET
      allocated_amount = EXCLUDED.allocated_amount, allocated_by = EXCLUDED.allocated_by, allocated_at = now();
  END IF;

  SELECT coalesce(sum(allocated_amount), 0) INTO v_paid_total
  FROM public.inbound_transport_sage_payment_allocations WHERE claim_id = p_claim_id;
  UPDATE public.inbound_transport_claims
  SET status = CASE WHEN v_paid_total >= calculated_amount - 0.01 THEN 'paid' ELSE 'approved' END,
      paid_by = CASE WHEN v_paid_total >= calculated_amount - 0.01 THEN auth.uid() ELSE NULL END,
      paid_at = CASE WHEN v_paid_total >= calculated_amount - 0.01 THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = p_claim_id;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_inbound_transport_sage_entry(uuid, uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_inbound_transport_sage_entry(uuid, uuid, numeric, text) TO authenticated, service_role;

-- Disable the previous prompt-based route. Payment is only confirmed from a
-- read-only imported Sage CBAP allocation.
DROP FUNCTION IF EXISTS public.mark_inbound_transport_claim_paid(uuid, text, text);
CREATE OR REPLACE FUNCTION public.mark_inbound_transport_claim_paid(uuid, text, text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Direct payment marking is disabled. Allocate the imported Sage payment to the linked transport delivery.';
END;
$$;

CREATE OR REPLACE VIEW public.v_inbound_transport_claim_reconciliation
WITH (security_invoker = true)
AS
WITH charge_totals AS (
  SELECT claim_id, sum(allocated_amount) AS charge_allocated,
         string_agg(h.reference || ' / ' || h.audit_number, ', ' ORDER BY h.transaction_date, h.audit_number) AS charge_evidence
  FROM public.inbound_transport_sage_charge_allocations a
  JOIN public.inbound_transport_sage_history h ON h.id = a.sage_history_id
  GROUP BY claim_id
), payment_totals AS (
  SELECT claim_id, sum(allocated_amount) AS payment_allocated,
         string_agg(h.reference || ' / ' || h.audit_number, ', ' ORDER BY h.transaction_date, h.audit_number) AS payment_evidence
  FROM public.inbound_transport_sage_payment_allocations a
  JOIN public.inbound_transport_sage_history h ON h.id = a.sage_history_id
  GROUP BY claim_id
)
SELECT c.id AS claim_id, coalesce(ch.charge_allocated, 0)::numeric(18,2) AS charge_allocated,
       coalesce(py.payment_allocated, 0)::numeric(18,2) AS payment_allocated,
       greatest(c.calculated_amount - coalesce(py.payment_allocated, 0), 0)::numeric(18,2) AS outstanding_amount,
       ch.charge_evidence, py.payment_evidence,
       CASE WHEN coalesce(py.payment_allocated, 0) >= c.calculated_amount - 0.01 THEN 'paid'
            WHEN coalesce(py.payment_allocated, 0) > 0 THEN 'part_paid'
            WHEN coalesce(ch.charge_allocated, 0) > 0 THEN 'awaiting_payment'
            ELSE 'awaiting_sage_charge' END AS reconciliation_status
FROM public.inbound_transport_claims c
LEFT JOIN charge_totals ch ON ch.claim_id = c.id
LEFT JOIN payment_totals py ON py.claim_id = c.id;

GRANT SELECT ON public.v_inbound_transport_claim_reconciliation TO authenticated;
NOTIFY pgrst, 'reload schema';
