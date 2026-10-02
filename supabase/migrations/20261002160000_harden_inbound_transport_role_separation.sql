-- Transport cost segregation of duties.
-- Finance may approve a GRN in its own workflow, but it cannot approve,
-- reconcile, or clear the freight evidence that supports a transporter payment.

DROP POLICY IF EXISTS inbound_transporters_read ON public.inbound_transporters;
DROP POLICY IF EXISTS inbound_transport_claims_read ON public.inbound_transport_claims;
DROP POLICY IF EXISTS inbound_transport_claim_history_read ON public.inbound_transport_claim_history;
DROP POLICY IF EXISTS inbound_transport_sage_history_reconciliation_read ON public.inbound_transport_sage_history;
DROP POLICY IF EXISTS inbound_transport_sage_sync_runs_reconciliation_read ON public.inbound_transport_sage_sync_runs;
DROP POLICY IF EXISTS inbound_transport_charge_allocations_reconciliation_read ON public.inbound_transport_sage_charge_allocations;
DROP POLICY IF EXISTS inbound_transport_payment_allocations_reconciliation_read ON public.inbound_transport_sage_payment_allocations;

CREATE POLICY inbound_transporters_read ON public.inbound_transporters FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));
CREATE POLICY inbound_transport_claims_read ON public.inbound_transport_claims FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));
CREATE POLICY inbound_transport_claim_history_read ON public.inbound_transport_claim_history FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));

-- Raw Materials can compare operational evidence to the constrained transporter
-- ledger; only Admin can change the delivery-to-Sage allocation.
CREATE POLICY inbound_transport_sage_history_reconciliation_read ON public.inbound_transport_sage_history FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));
CREATE POLICY inbound_transport_sage_sync_runs_reconciliation_read ON public.inbound_transport_sage_sync_runs FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));
CREATE POLICY inbound_transport_charge_allocations_reconciliation_read ON public.inbound_transport_sage_charge_allocations FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));
CREATE POLICY inbound_transport_payment_allocations_reconciliation_read ON public.inbound_transport_sage_payment_allocations FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));

CREATE OR REPLACE FUNCTION public.guard_inbound_transport_claim_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- The GRN trigger creates its evidence claim as a nested operation.
  IF TG_OP = 'INSERT' AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NOT public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']) THEN
    RAISE EXCEPTION 'Transport claims may only be handled by Raw Materials or Admin.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_inbound_transport_claim(
  p_claim_id uuid,
  p_approved boolean,
  p_note text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_claim public.inbound_transport_claims%ROWTYPE;
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Only Admin may approve or return a transport claim.';
  END IF;

  SELECT * INTO v_claim FROM public.inbound_transport_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR v_claim.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only submitted claims can be reviewed.';
  END IF;
  IF v_claim.created_by = auth.uid() THEN
    RAISE EXCEPTION 'A claim cannot be approved or rejected by its creator.';
  END IF;
  IF NOT p_approved AND nullif(btrim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'A rejection reason is required.';
  END IF;

  UPDATE public.inbound_transport_claims
  SET status = CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(btrim(p_note), ''),
      updated_at = now()
  WHERE id = p_claim_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_inbound_transport_sage_entry(
  p_claim_id uuid,
  p_sage_history_id uuid,
  p_allocated_amount numeric,
  p_entry_type text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    RAISE EXCEPTION 'Only Admin may reconcile imported Sage transport evidence.';
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

NOTIFY pgrst, 'reload schema';
