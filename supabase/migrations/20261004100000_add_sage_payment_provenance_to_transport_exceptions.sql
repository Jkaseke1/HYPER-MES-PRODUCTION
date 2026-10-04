-- Make unmatched transporter payments immediately actionable. These fields are
-- copied from the read-only Sage PostAP import; this migration does not post to
-- Sage or modify any financial transaction.

CREATE OR REPLACE VIEW public.v_inbound_transport_exceptions WITH (security_invoker = true) AS
WITH settings AS (
  SELECT monitoring_enabled_from
  FROM public.inbound_transport_reconciliation_settings
  WHERE singleton
), claims AS (
  SELECT c.id, c.claim_number, c.status, c.calculated_amount, c.currency_code, c.invoice_number, c.waybill_reference,
    g.grn_number, t.ticket_no, tr.name AS transporter_name, r.charge_allocated, r.payment_allocated, r.outstanding_amount, r.reconciliation_status
  FROM public.inbound_transport_claims c
  JOIN public.goods_received_notes g ON g.id = c.grn_id
  JOIN public.weigh_bridge_tickets t ON t.id = c.weigh_bridge_ticket_id
  JOIN public.inbound_transporters tr ON tr.id = c.transporter_id
  LEFT JOIN public.v_inbound_transport_claim_reconciliation r ON r.claim_id = c.id
), missing_claims AS (
  SELECT g.grn_number, t.ticket_no, tr.name AS transporter_name, t.nett_mass, t.inbound_rate_per_tonne
  FROM public.goods_received_notes g
  JOIN public.weigh_bridge_tickets t ON t.id = g.weigh_bridge_ticket_id
  LEFT JOIN public.inbound_transporters tr ON tr.id = t.inbound_transporter_id
  LEFT JOIN public.inbound_transport_claims c ON c.grn_id = g.id
  WHERE t.inbound_transport_mode = 'company_hired' AND c.id IS NULL
)
SELECT
  'company_hired_grn_missing_claim'::text AS exception_type,
  'high'::text AS severity,
  grn_number,
  ticket_no,
  transporter_name,
  null::text AS claim_number,
  round((coalesce(nett_mass, 0) / 1000) * coalesce(inbound_rate_per_tonne, 0), 2) AS expected_amount,
  null::numeric AS sage_charge_amount,
  null::numeric AS sage_paid_amount,
  'Company-hired delivery has a GRN but no PlantControl transport claim.'::text AS detail,
  'Raw Materials Manager must review the linked ticket and GRN before any freight is processed.'::text AS action,
  null::date AS sage_transaction_date,
  null::text AS sage_reference,
  null::text AS sage_audit_number,
  null::text AS sage_posting_user
FROM missing_claims
UNION ALL
SELECT
  'claim_missing_supporting_document', 'review', grn_number, ticket_no, transporter_name, claim_number,
  calculated_amount, charge_allocated, payment_allocated,
  'Transport claim has neither supplier invoice nor waybill reference.',
  'Raw Materials Manager must add a supplier document before submitting the claim.',
  null::date, null::text, null::text, null::text
FROM claims
WHERE status IN ('draft', 'submitted', 'approved')
  AND invoice_number IS NULL AND waybill_reference IS NULL
UNION ALL
SELECT
  'approved_claim_awaiting_sage_charge', 'review', grn_number, ticket_no, transporter_name, claim_number,
  calculated_amount, charge_allocated, payment_allocated,
  'Approved expected freight has no matched Sage charge yet.',
  'Admin must match the imported Sage charge or investigate before payment.',
  null::date, null::text, null::text, null::text
FROM claims
WHERE status = 'approved' AND coalesce(reconciliation_status, 'awaiting_sage_charge') = 'awaiting_sage_charge'
UNION ALL
SELECT
  CASE WHEN reconciliation_status = 'part_paid' THEN 'claim_part_paid' ELSE 'charge_awaiting_payment' END,
  'review', grn_number, ticket_no, transporter_name, claim_number,
  calculated_amount, charge_allocated, payment_allocated,
  'Sage charge is linked but the expected delivery value is not fully paid.',
  'Admin must reconcile the remaining Sage payment or record the reason for the balance.',
  null::date, null::text, null::text, null::text
FROM claims
WHERE reconciliation_status IN ('awaiting_payment', 'part_paid')
UNION ALL
SELECT
  'sage_payment_unmatched', 'high', null, null, tr.name, null,
  null, null, h.debit - h.credit,
  'Imported Sage transporter payment is not allocated to a PlantControl delivery.',
  'Admin must reconcile this exact Sage payment to a matching approved claim before treating it as cleared.',
  h.transaction_date, h.reference, h.audit_number, h.posting_user
FROM public.inbound_transport_sage_history h
JOIN public.inbound_transporters tr
  ON upper(btrim(tr.sage_supplier_account)) = upper(btrim(h.supplier_account))
WHERE h.transaction_type = 'CBAP'
  AND h.transaction_date >= (SELECT monitoring_enabled_from FROM settings)
  AND NOT EXISTS (
    SELECT 1
    FROM public.inbound_transport_sage_payment_allocations a
    WHERE a.sage_history_id = h.id
  );

GRANT SELECT ON public.v_inbound_transport_exceptions TO authenticated;
NOTIFY pgrst, 'reload schema';
