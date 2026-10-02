-- Raw Materials owns the physical transport evidence. Finance owns approval
-- and payment reconciliation. Sage remains a read-only evidence source.

DROP POLICY IF EXISTS inbound_transporters_read ON public.inbound_transporters;
DROP POLICY IF EXISTS inbound_transporters_manage ON public.inbound_transporters;
DROP POLICY IF EXISTS inbound_transport_claims_read ON public.inbound_transport_claims;
DROP POLICY IF EXISTS inbound_transport_claim_history_read ON public.inbound_transport_claim_history;

CREATE POLICY inbound_transporters_read ON public.inbound_transporters FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));
CREATE POLICY inbound_transporters_manage ON public.inbound_transporters FOR ALL TO authenticated
  USING (public.has_mes_role(ARRAY['admin'])) WITH CHECK (public.has_mes_role(ARRAY['admin']));
CREATE POLICY inbound_transport_claims_read ON public.inbound_transport_claims FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));
CREATE POLICY inbound_transport_claim_history_read ON public.inbound_transport_claim_history FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));

DROP POLICY IF EXISTS inbound_transport_sage_history_admin_read ON public.inbound_transport_sage_history;
CREATE POLICY inbound_transport_sage_history_reconciliation_read ON public.inbound_transport_sage_history FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));
DROP POLICY IF EXISTS inbound_transport_sage_sync_runs_admin_read ON public.inbound_transport_sage_sync_runs;
CREATE POLICY inbound_transport_sage_sync_runs_reconciliation_read ON public.inbound_transport_sage_sync_runs FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));
DROP POLICY IF EXISTS inbound_transport_charge_allocations_admin_read ON public.inbound_transport_sage_charge_allocations;
CREATE POLICY inbound_transport_charge_allocations_reconciliation_read ON public.inbound_transport_sage_charge_allocations FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));
DROP POLICY IF EXISTS inbound_transport_payment_allocations_admin_read ON public.inbound_transport_sage_payment_allocations;
CREATE POLICY inbound_transport_payment_allocations_reconciliation_read ON public.inbound_transport_sage_payment_allocations FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));

CREATE OR REPLACE FUNCTION public.guard_weighbridge_hired_transport_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']) AND (
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
    RAISE EXCEPTION 'Only the Raw Materials Manager or Admin may record company-hired transport details.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_inbound_transport_claim_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NOT public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']) THEN
    RAISE EXCEPTION 'Transport claims may only be handled by Raw Materials or Admin.';
  END IF;
  RETURN NEW;
END;
$$;

-- Once a GRN exists, physical delivery and rate evidence cannot be rewritten.
-- A correction needs a documented GRN/claim exception rather than overwriting
-- the original ticket used to check a transport payment.
CREATE OR REPLACE FUNCTION public.lock_linked_weighbridge_transport_evidence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.goods_received_notes WHERE weigh_bridge_ticket_id = OLD.id)
    AND (
      NEW.inbound_transport_mode IS DISTINCT FROM OLD.inbound_transport_mode
      OR NEW.inbound_transporter_id IS DISTINCT FROM OLD.inbound_transporter_id
      OR NEW.inbound_rate_per_tonne IS DISTINCT FROM OLD.inbound_rate_per_tonne
      OR NEW.inbound_currency_code IS DISTINCT FROM OLD.inbound_currency_code
      OR NEW.inbound_invoice_number IS DISTINCT FROM OLD.inbound_invoice_number
      OR NEW.inbound_waybill_reference IS DISTINCT FROM OLD.inbound_waybill_reference
      OR NEW.inbound_transport_notes IS DISTINCT FROM OLD.inbound_transport_notes
    ) THEN
    RAISE EXCEPTION 'Inbound transport evidence is locked once its GRN exists. Record a documented exception; do not overwrite the ticket.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_linked_weighbridge_transport_evidence ON public.weigh_bridge_tickets;
CREATE TRIGGER trg_lock_linked_weighbridge_transport_evidence
  BEFORE UPDATE OF inbound_transport_mode, inbound_transporter_id, inbound_rate_per_tonne,
    inbound_currency_code, inbound_invoice_number, inbound_waybill_reference, inbound_transport_notes
  ON public.weigh_bridge_tickets FOR EACH ROW EXECUTE FUNCTION public.lock_linked_weighbridge_transport_evidence();

CREATE OR REPLACE FUNCTION public.allocate_inbound_transport_sage_entry(
  p_claim_id uuid, p_sage_history_id uuid, p_allocated_amount numeric, p_entry_type text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_claim public.inbound_transport_claims%ROWTYPE; v_entry public.inbound_transport_sage_history%ROWTYPE;
  v_supplier_account text; v_existing_claim_total numeric(18,2); v_existing_entry_total numeric(18,2);
  v_current_amount numeric(18,2); v_entry_amount numeric(18,2); v_paid_total numeric(18,2);
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin']) THEN RAISE EXCEPTION 'Only Admin may reconcile imported Sage transport evidence.'; END IF;
  IF p_entry_type NOT IN ('APTx', 'CBAP') OR coalesce(p_allocated_amount, 0) <= 0 THEN RAISE EXCEPTION 'Choose a Sage charge or payment and enter a positive allocation amount.'; END IF;
  SELECT * INTO v_claim FROM public.inbound_transport_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR v_claim.status NOT IN ('approved', 'paid') THEN RAISE EXCEPTION 'Only an approved transport claim can be reconciled.'; END IF;
  SELECT sage_supplier_account INTO v_supplier_account FROM public.inbound_transporters WHERE id = v_claim.transporter_id AND is_active;
  IF nullif(btrim(v_supplier_account), '') IS NULL THEN RAISE EXCEPTION 'This transporter does not have a verified Sage supplier account.'; END IF;
  SELECT * INTO v_entry FROM public.inbound_transport_sage_history WHERE id = p_sage_history_id FOR UPDATE;
  IF NOT FOUND OR v_entry.transaction_type <> p_entry_type OR upper(btrim(v_entry.supplier_account)) <> upper(btrim(v_supplier_account)) THEN RAISE EXCEPTION 'The imported Sage entry is not the selected transporter % entry type.', p_entry_type; END IF;
  v_entry_amount := CASE WHEN p_entry_type = 'APTx' THEN v_entry.credit - v_entry.debit ELSE v_entry.debit - v_entry.credit END;
  IF v_entry_amount <= 0 THEN RAISE EXCEPTION 'The selected Sage entry has no allocatable amount.'; END IF;
  IF p_entry_type = 'APTx' THEN
    SELECT allocated_amount INTO v_current_amount FROM public.inbound_transport_sage_charge_allocations WHERE claim_id = p_claim_id AND sage_history_id = p_sage_history_id;
    SELECT coalesce(sum(allocated_amount),0) INTO v_existing_claim_total FROM public.inbound_transport_sage_charge_allocations WHERE claim_id = p_claim_id;
    SELECT coalesce(sum(allocated_amount),0) INTO v_existing_entry_total FROM public.inbound_transport_sage_charge_allocations WHERE sage_history_id = p_sage_history_id;
    IF v_existing_claim_total-coalesce(v_current_amount,0)+p_allocated_amount > v_claim.calculated_amount+0.01 OR v_existing_entry_total-coalesce(v_current_amount,0)+p_allocated_amount > v_entry_amount+0.01 THEN RAISE EXCEPTION 'Charge allocation exceeds the available claim or Sage charge value.'; END IF;
    INSERT INTO public.inbound_transport_sage_charge_allocations(claim_id,sage_history_id,allocated_amount,allocated_by) VALUES(p_claim_id,p_sage_history_id,p_allocated_amount,auth.uid()) ON CONFLICT(claim_id,sage_history_id) DO UPDATE SET allocated_amount=EXCLUDED.allocated_amount, allocated_by=EXCLUDED.allocated_by, allocated_at=now();
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.inbound_transport_sage_charge_allocations WHERE claim_id=p_claim_id) THEN RAISE EXCEPTION 'Match a Sage charge to this delivery before allocating a Sage payment.'; END IF;
    SELECT allocated_amount INTO v_current_amount FROM public.inbound_transport_sage_payment_allocations WHERE claim_id = p_claim_id AND sage_history_id = p_sage_history_id;
    SELECT coalesce(sum(allocated_amount),0) INTO v_existing_claim_total FROM public.inbound_transport_sage_payment_allocations WHERE claim_id = p_claim_id;
    SELECT coalesce(sum(allocated_amount),0) INTO v_existing_entry_total FROM public.inbound_transport_sage_payment_allocations WHERE sage_history_id = p_sage_history_id;
    IF v_existing_claim_total-coalesce(v_current_amount,0)+p_allocated_amount > v_claim.calculated_amount+0.01 OR v_existing_entry_total-coalesce(v_current_amount,0)+p_allocated_amount > v_entry_amount+0.01 THEN RAISE EXCEPTION 'Payment allocation exceeds the available claim or Sage payment value.'; END IF;
    INSERT INTO public.inbound_transport_sage_payment_allocations(claim_id,sage_history_id,allocated_amount,allocated_by) VALUES(p_claim_id,p_sage_history_id,p_allocated_amount,auth.uid()) ON CONFLICT(claim_id,sage_history_id) DO UPDATE SET allocated_amount=EXCLUDED.allocated_amount, allocated_by=EXCLUDED.allocated_by, allocated_at=now();
  END IF;
  SELECT coalesce(sum(allocated_amount),0) INTO v_paid_total FROM public.inbound_transport_sage_payment_allocations WHERE claim_id=p_claim_id;
  UPDATE public.inbound_transport_claims SET status=CASE WHEN v_paid_total >= calculated_amount-0.01 THEN 'paid' ELSE 'approved' END, paid_by=CASE WHEN v_paid_total >= calculated_amount-0.01 THEN auth.uid() ELSE NULL END, paid_at=CASE WHEN v_paid_total >= calculated_amount-0.01 THEN now() ELSE NULL END, updated_at=now() WHERE id=p_claim_id;
END;
$$;

CREATE OR REPLACE VIEW public.v_inbound_transport_exceptions WITH (security_invoker = true) AS
WITH settings AS (SELECT monitoring_enabled_from FROM public.inbound_transport_reconciliation_settings WHERE singleton),
claims AS (
  SELECT c.id, c.claim_number, c.status, c.calculated_amount, c.currency_code, c.invoice_number, c.waybill_reference,
    g.grn_number, t.ticket_no, tr.name AS transporter_name, r.charge_allocated, r.payment_allocated, r.outstanding_amount, r.reconciliation_status
  FROM public.inbound_transport_claims c
  JOIN public.goods_received_notes g ON g.id=c.grn_id JOIN public.weigh_bridge_tickets t ON t.id=c.weigh_bridge_ticket_id
  JOIN public.inbound_transporters tr ON tr.id=c.transporter_id LEFT JOIN public.v_inbound_transport_claim_reconciliation r ON r.claim_id=c.id
), missing_claims AS (
  SELECT g.grn_number, t.ticket_no, tr.name AS transporter_name, t.nett_mass, t.inbound_rate_per_tonne, t.inbound_currency_code
  FROM public.goods_received_notes g JOIN public.weigh_bridge_tickets t ON t.id=g.weigh_bridge_ticket_id
  LEFT JOIN public.inbound_transporters tr ON tr.id=t.inbound_transporter_id LEFT JOIN public.inbound_transport_claims c ON c.grn_id=g.id
  WHERE t.inbound_transport_mode='company_hired' AND c.id IS NULL
)
SELECT 'company_hired_grn_missing_claim'::text AS exception_type, 'high'::text AS severity, grn_number, ticket_no, transporter_name, null::text AS claim_number,
  round((coalesce(nett_mass,0)/1000)*coalesce(inbound_rate_per_tonne,0),2) AS expected_amount, null::numeric AS sage_charge_amount, null::numeric AS sage_paid_amount,
  'Company-hired delivery has a GRN but no PlantControl transport claim.'::text AS detail, 'Raw Materials Manager must review the linked ticket and GRN before any freight is processed.'::text AS action
FROM missing_claims
UNION ALL
SELECT 'claim_missing_supporting_document', 'review', grn_number, ticket_no, transporter_name, claim_number, calculated_amount, charge_allocated, payment_allocated,
  'Transport claim has neither supplier invoice nor waybill reference.', 'Raw Materials Manager must add a supplier document before submitting the claim.'
FROM claims WHERE status IN ('draft','submitted','approved') AND invoice_number IS NULL AND waybill_reference IS NULL
UNION ALL
SELECT 'approved_claim_awaiting_sage_charge', 'review', grn_number, ticket_no, transporter_name, claim_number, calculated_amount, charge_allocated, payment_allocated,
  'Approved expected freight has no matched Sage charge yet.', 'Admin must match the imported Sage charge or investigate before payment.'
FROM claims WHERE status='approved' AND coalesce(reconciliation_status,'awaiting_sage_charge')='awaiting_sage_charge'
UNION ALL
SELECT CASE WHEN reconciliation_status='part_paid' THEN 'claim_part_paid' ELSE 'charge_awaiting_payment' END, 'review', grn_number, ticket_no, transporter_name, claim_number, calculated_amount, charge_allocated, payment_allocated,
  'Sage charge is linked but the expected delivery value is not fully paid.', 'Admin must reconcile the remaining Sage payment or record the reason for the balance.'
FROM claims WHERE reconciliation_status IN ('awaiting_payment','part_paid')
UNION ALL
SELECT 'sage_payment_unmatched', 'high', null, null, tr.name, null, null, null, h.debit-h.credit,
  'Imported Sage transporter payment is not allocated to a PlantControl delivery.', 'Admin must reconcile the payment to a matching approved claim before treating it as cleared.'
FROM public.inbound_transport_sage_history h JOIN public.inbound_transporters tr ON upper(btrim(tr.sage_supplier_account))=upper(btrim(h.supplier_account))
WHERE h.transaction_type='CBAP' AND h.transaction_date >= (SELECT monitoring_enabled_from FROM settings)
  AND NOT EXISTS (SELECT 1 FROM public.inbound_transport_sage_payment_allocations a WHERE a.sage_history_id=h.id);

GRANT SELECT ON public.v_inbound_transport_exceptions TO authenticated;
NOTIFY pgrst, 'reload schema';
