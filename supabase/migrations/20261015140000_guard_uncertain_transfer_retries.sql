-- Do not replay a transfer whose response was lost or whose confirmed result
-- could not be saved. Reconcile the original Sage movement first.
CREATE OR REPLACE FUNCTION public.guard_uncertain_transfer_retry()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.event_type = 'material_transfer_to_production'
     AND OLD.status = 'failed' AND NEW.status = 'pending'
     AND (coalesce(OLD.error_details->>'postingOutcomeUnknown', 'false') = 'true'
          OR OLD.sage_response->>'sagePosting' = 'completed') THEN
    RAISE EXCEPTION 'Sage posting may already exist. Verify and reconcile the original transfer before retrying.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_uncertain_transfer_retry ON public.sync_log;
CREATE TRIGGER guard_uncertain_transfer_retry
BEFORE UPDATE OF status ON public.sync_log
FOR EACH ROW EXECUTE FUNCTION public.guard_uncertain_transfer_retry();
