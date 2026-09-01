-- Preserve a Sage failure's outcome when the same queue event is retried.
ALTER TABLE public.sync_log
  ADD COLUMN IF NOT EXISTS last_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_failure_message text,
  ADD COLUMN IF NOT EXISTS last_failure_details jsonb,
  ADD COLUMN IF NOT EXISTS retried_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_requested_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sync_log_retry_resolution
  ON public.sync_log (status, resolved_at DESC)
  WHERE retried_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.request_sync_retry(p_log_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log public.sync_log%ROWTYPE;
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'finance', 'accountant', 'production_manager', 'warehouse_manager', 'raw_material_manager', 'rm_manager']) THEN
    RAISE EXCEPTION 'You are not permitted to retry Sage events.';
  END IF;

  SELECT * INTO v_log
  FROM public.sync_log
  WHERE id = p_log_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sage queue event was not found.';
  END IF;

  IF v_log.status <> 'failed' THEN
    RAISE EXCEPTION 'Only failed Sage events can be retried.';
  END IF;

  UPDATE public.sync_log
  SET
    status = 'pending',
    last_failed_at = COALESCE(last_failed_at, updated_at),
    last_failure_message = COALESCE(last_failure_message, message),
    last_failure_details = COALESCE(last_failure_details, error_details),
    retried_at = now(),
    retry_requested_by = auth.uid(),
    resolved_at = NULL,
    message = format('Retry requested after Sage failure at %s.', to_char(COALESCE(last_failed_at, updated_at), 'YYYY-MM-DD HH24:MI')),
    updated_at = now()
  WHERE id = v_log.id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_sync_retry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_sync_retry(uuid) TO authenticated, service_role;
