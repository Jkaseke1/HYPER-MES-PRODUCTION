-- Production GRV sequence reservation contract.
-- This creates no sequence row and reserves no document number. Finance must
-- initialize SAGE_GRV/year 0 from the live Sage report during the cutover.

CREATE OR REPLACE FUNCTION public.reserve_next_sage_grv_sequence()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sequence integer;
BEGIN
  UPDATE public.batch_sequences
  SET next_sequence = next_sequence + 1,
      updated_at = now()
  WHERE prefix = 'SAGE_GRV'
    AND year = 0
  RETURNING next_sequence - 1 INTO v_sequence;

  IF v_sequence IS NULL THEN
    RAISE EXCEPTION 'Sage GRV sequence is not initialized. Finance must set the next live Sage GRV number before GRNs are created.';
  END IF;

  RETURN v_sequence;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_next_sage_grv_sequence() TO authenticated, service_role;
