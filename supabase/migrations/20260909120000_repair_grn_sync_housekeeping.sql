-- Repair post-success housekeeping after the Sage GRV is already posted.
-- This migration does not create or modify Sage transactions.

CREATE OR REPLACE FUNCTION public.advance_sage_grv_sequence(
  p_grv_number text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sequence integer;
BEGIN
  IF p_grv_number IS NULL OR p_grv_number !~ '^HFGRV[0-9]+$' THEN
    RAISE EXCEPTION 'Invalid Sage GRV number: %', p_grv_number;
  END IF;

  v_sequence := substring(p_grv_number from 6)::integer;

  UPDATE public.batch_sequences
  SET next_sequence = GREATEST(next_sequence, v_sequence + 1),
      updated_at = now()
  WHERE prefix = 'SAGE_GRV'
    AND year = 0;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sage GRV sequence is not initialized.';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_sage_grv_sequence(text)
TO authenticated, service_role;
