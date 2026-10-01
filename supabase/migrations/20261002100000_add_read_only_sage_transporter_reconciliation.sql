-- Read-only Sage transporter-cost reconciliation.
-- This migration does not create Sage connectivity and cannot post, amend or pay
-- anything in Sage. The local bridge uses service-role writes only after an
-- authenticated SDK GET endpoint returns constrained PostAP records.

CREATE TABLE IF NOT EXISTS public.inbound_transport_sage_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  source text NOT NULL CHECK (source = 'sage-sdk-postap'),
  from_date date NOT NULL,
  to_date date NOT NULL,
  supplier_accounts text[] NOT NULL DEFAULT '{}',
  entry_count integer NOT NULL DEFAULT 0 CHECK (entry_count >= 0),
  message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK (to_date > from_date)
);

ALTER TABLE public.inbound_transport_sage_history
  ADD COLUMN IF NOT EXISTS sage_auto_index bigint,
  ADD COLUMN IF NOT EXISTS foreign_debit numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS foreign_credit numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_allocations text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS imported_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_run_id uuid REFERENCES public.inbound_transport_sage_sync_runs(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inbound_transport_sage_history_auto_index
  ON public.inbound_transport_sage_history (company_database, sage_auto_index)
  WHERE sage_auto_index IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inbound_transport_sage_history_payment_match
  ON public.inbound_transport_sage_history (supplier_account, transaction_type, reference, audit_number)
  WHERE transaction_type = 'CBAP';

CREATE INDEX IF NOT EXISTS idx_inbound_transport_sage_sync_runs_finished
  ON public.inbound_transport_sage_sync_runs (finished_at DESC);

ALTER TABLE public.inbound_transport_sage_sync_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbound_transport_sage_sync_runs FROM anon, authenticated;
GRANT SELECT ON public.inbound_transport_sage_sync_runs TO authenticated;
DROP POLICY IF EXISTS inbound_transport_sage_sync_runs_admin_read ON public.inbound_transport_sage_sync_runs;
CREATE POLICY inbound_transport_sage_sync_runs_admin_read
  ON public.inbound_transport_sage_sync_runs FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin']));

ALTER TABLE public.inbound_transport_claims
  ADD COLUMN IF NOT EXISTS sage_payment_audit_number text,
  ADD COLUMN IF NOT EXISTS sage_payment_matched_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inbound_transport_claims_sage_payment_audit
  ON public.inbound_transport_claims (sage_payment_audit_number)
  WHERE sage_payment_audit_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.inbound_transport_reconciliation_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  monitoring_enabled_from date NOT NULL DEFAULT current_date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.inbound_transport_reconciliation_settings (singleton, monitoring_enabled_from)
VALUES (true, current_date)
ON CONFLICT (singleton) DO NOTHING;

-- A payment is never treated as reconciled merely because a user typed a
-- reference. It must be an imported Sage payment for the mapped transporter,
-- with the exact audit number and the exact claim amount.
DROP FUNCTION IF EXISTS public.mark_inbound_transport_claim_paid(uuid, text);
CREATE OR REPLACE FUNCTION public.mark_inbound_transport_claim_paid(
  p_claim_id uuid,
  p_payment_reference text,
  p_sage_payment_audit_number text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim public.inbound_transport_claims%ROWTYPE;
  v_supplier_account text;
  v_payment public.inbound_transport_sage_history%ROWTYPE;
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Only Admin may mark a transport claim as paid.';
  END IF;
  IF nullif(btrim(p_payment_reference), '') IS NULL OR nullif(btrim(p_sage_payment_audit_number), '') IS NULL THEN
    RAISE EXCEPTION 'A Sage payment reference and Sage audit number are required.';
  END IF;

  SELECT * INTO v_claim
  FROM public.inbound_transport_claims
  WHERE id = p_claim_id
  FOR UPDATE;
  IF NOT FOUND OR v_claim.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved transport claim can be marked as paid.';
  END IF;

  SELECT sage_supplier_account INTO v_supplier_account
  FROM public.inbound_transporters
  WHERE id = v_claim.transporter_id
    AND is_active;
  IF nullif(btrim(v_supplier_account), '') IS NULL THEN
    RAISE EXCEPTION 'This transporter has no verified Sage supplier account.';
  END IF;

  SELECT * INTO v_payment
  FROM public.inbound_transport_sage_history
  WHERE company_database = 'Hyperfeeds 2024'
    AND supplier_account = upper(btrim(v_supplier_account))
    AND transaction_type = 'CBAP'
    AND upper(btrim(reference)) = upper(btrim(p_payment_reference))
    AND audit_number = btrim(p_sage_payment_audit_number)
    AND abs((debit - credit) - v_claim.calculated_amount) <= 0.01
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No exact Sage payment match was imported. Confirm transporter, reference, audit number and amount, then wait for the next read-only sync.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inbound_transport_claims
    WHERE sage_payment_audit_number = v_payment.audit_number
  ) THEN
    RAISE EXCEPTION 'This Sage payment audit number is already matched to another transport claim.';
  END IF;

  UPDATE public.inbound_transport_claims
  SET status = 'paid',
      paid_by = auth.uid(),
      paid_at = now(),
      payment_reference = upper(btrim(p_payment_reference)),
      sage_payment_audit_number = v_payment.audit_number,
      sage_payment_matched_at = now(),
      updated_at = now()
  WHERE id = p_claim_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_inbound_transport_claim_paid(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_inbound_transport_claim_paid(uuid, text, text) TO authenticated, service_role;

-- These are review queues, not accusations. The monitoring date avoids
-- treating the one-time September history import as a live workflow breach.
CREATE OR REPLACE VIEW public.v_inbound_transport_sage_exceptions
WITH (security_invoker = true)
AS
WITH settings AS (
  SELECT monitoring_enabled_from FROM public.inbound_transport_reconciliation_settings WHERE singleton
), duplicate_payments AS (
  SELECT supplier_account, upper(btrim(reference)) AS payment_reference,
         array_agg(audit_number ORDER BY audit_number) AS audit_numbers,
         count(*) AS occurrence_count
  FROM public.inbound_transport_sage_history
  WHERE transaction_type = 'CBAP'
    AND transaction_date >= (SELECT monitoring_enabled_from FROM settings)
    AND nullif(btrim(reference), '') IS NOT NULL
  GROUP BY supplier_account, upper(btrim(reference))
  HAVING count(*) > 1
), unmatched_payments AS (
  SELECT h.id, h.supplier_account, h.reference, h.audit_number, h.transaction_date,
         (h.debit - h.credit) AS amount
  FROM public.inbound_transport_sage_history h
  WHERE h.transaction_type = 'CBAP'
    AND h.transaction_date >= (SELECT monitoring_enabled_from FROM settings)
    AND NOT EXISTS (
      SELECT 1 FROM public.inbound_transport_claims c
      WHERE c.sage_payment_audit_number = h.audit_number
    )
)
SELECT
  'duplicate_sage_payment_reference'::text AS exception_type,
  'high'::text AS severity,
  d.supplier_account,
  d.payment_reference AS reference,
  array_to_string(d.audit_numbers, ', ') AS audit_number,
  null::date AS transaction_date,
  null::numeric AS amount,
  format('Payment reference appears %s times for this transporter. Review payment vouchers and allocations.', d.occurrence_count) AS detail
FROM duplicate_payments d
UNION ALL
SELECT
  'sage_payment_awaiting_match'::text,
  'review'::text,
  p.supplier_account,
  p.reference,
  p.audit_number,
  p.transaction_date,
  p.amount,
  'Imported Sage payment has not yet been matched to an approved PlantControl transport claim.'::text
FROM unmatched_payments p;

GRANT SELECT ON public.v_inbound_transport_sage_exceptions TO authenticated;
NOTIFY pgrst, 'reload schema';
