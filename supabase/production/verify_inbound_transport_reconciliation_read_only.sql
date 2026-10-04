-- Read-only transport reconciliation verification.
-- Safe to run in the Supabase SQL Editor: it contains SELECT statements only.

WITH checks AS (
  SELECT
    'Legacy direct-payment RPC removed' AS control,
    NOT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'mark_inbound_transport_claim_paid'
    ) AS passed
  UNION ALL
  SELECT
    'Paid-status database guard installed',
    EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid = 'public.inbound_transport_claims'::regclass
        AND t.tgname = 'trg_guard_inbound_transport_paid_status'
        AND NOT t.tgisinternal
    )
  UNION ALL
  SELECT
    'Reconciliation RPC available',
    to_regprocedure('public.allocate_inbound_transport_sage_entry(uuid,uuid,numeric,text)') IS NOT NULL
)
SELECT control, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks
ORDER BY control;

WITH payment_totals AS (
  SELECT claim_id, coalesce(sum(allocated_amount), 0) AS payment_allocated
  FROM public.inbound_transport_sage_payment_allocations
  GROUP BY claim_id
)
SELECT
  c.claim_number,
  c.status,
  c.calculated_amount,
  coalesce(p.payment_allocated, 0) AS payment_allocated,
  CASE
    WHEN c.status = 'paid' AND coalesce(p.payment_allocated, 0) < c.calculated_amount - 0.01
      THEN 'FAIL: paid without sufficient imported Sage payment evidence'
    ELSE 'PASS'
  END AS result
FROM public.inbound_transport_claims c
LEFT JOIN payment_totals p ON p.claim_id = c.id
WHERE c.status = 'paid'
ORDER BY c.updated_at DESC;

WITH all_allocations AS (
  SELECT sage_history_id, allocated_amount
  FROM public.inbound_transport_sage_charge_allocations
  UNION ALL
  SELECT sage_history_id, allocated_amount
  FROM public.inbound_transport_sage_payment_allocations
), entry_allocations AS (
  SELECT sage_history_id, sum(allocated_amount) AS allocated_amount
  FROM all_allocations
  GROUP BY sage_history_id
)
SELECT
  h.audit_number,
  h.supplier_account,
  h.transaction_type,
  CASE WHEN h.transaction_type = 'APTx' THEN h.credit - h.debit ELSE h.debit - h.credit END AS sage_entry_amount,
  coalesce(a.allocated_amount, 0) AS allocated_amount,
  CASE
    WHEN coalesce(a.allocated_amount, 0) >
      CASE WHEN h.transaction_type = 'APTx' THEN h.credit - h.debit ELSE h.debit - h.credit END + 0.01
      THEN 'FAIL: allocated above imported Sage entry value'
    ELSE 'PASS'
  END AS result
FROM public.inbound_transport_sage_history h
LEFT JOIN entry_allocations a ON a.sage_history_id = h.id
WHERE coalesce(a.allocated_amount, 0) >
  CASE WHEN h.transaction_type = 'APTx' THEN h.credit - h.debit ELSE h.debit - h.credit END + 0.01
ORDER BY h.audit_number;

SELECT
  c.claim_number,
  c.status,
  'FAIL: Sage payment allocated before any Sage charge' AS result
FROM public.inbound_transport_claims c
WHERE EXISTS (
  SELECT 1 FROM public.inbound_transport_sage_payment_allocations p WHERE p.claim_id = c.id
)
AND NOT EXISTS (
  SELECT 1 FROM public.inbound_transport_sage_charge_allocations ch WHERE ch.claim_id = c.id
)
ORDER BY c.claim_number;
