-- Prevent weighbridge tickets from being reused while their GRN is in progress.

DO $$
DECLARE
  v_constraint text;
BEGIN
  SELECT conname INTO v_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.weigh_bridge_tickets'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%'
    AND pg_get_constraintdef(oid) LIKE '%open%'
  LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.weigh_bridge_tickets DROP CONSTRAINT %I', v_constraint);
  END IF;
END $$;

ALTER TABLE public.weigh_bridge_tickets
  ADD CONSTRAINT weigh_bridge_tickets_status_check
  CHECK (status IN ('open', 'in_grn', 'linked', 'cancelled'));

-- Reconcile tickets created before this workflow state existed.
UPDATE public.weigh_bridge_tickets wb
SET status = CASE WHEN grn.status = 'approved' THEN 'linked' ELSE 'in_grn' END,
    updated_at = now()
FROM public.goods_received_notes grn
WHERE grn.weigh_bridge_ticket_id = wb.id
  AND wb.status = 'open';

-- Allow the approval function to complete a ticket that is already reserved by its GRN.
DO $$
DECLARE
  v_name text;
  v_sql text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['approve_grn_and_queue', 'sync_approved_grn_to_workflow'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_sql
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = v_name
      AND pg_get_function_identity_arguments(p.oid) = 'p_grn_id uuid';

    IF v_sql IS NOT NULL THEN
      v_sql := replace(v_sql, '''open'', ''linked''', '''open'', ''in_grn'', ''linked''');
      EXECUTE v_sql;
    END IF;
  END LOOP;
END $$;
