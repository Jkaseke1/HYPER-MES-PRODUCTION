-- Apply after the frontend containing the Manual GRV Number field is deployed.
-- This sequencing prevents the old capture form from being interrupted mid-rollout.

CREATE OR REPLACE FUNCTION public.require_manual_grv_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.manual_grv_number IS NULL OR length(trim(NEW.manual_grv_number)) = 0 THEN
    RAISE EXCEPTION 'Manual GRV number is required.';
  END IF;
  NEW.manual_grv_number := trim(NEW.manual_grv_number);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_manual_grv_number ON public.goods_received_notes;
CREATE TRIGGER trg_require_manual_grv_number
  BEFORE INSERT OR UPDATE OF manual_grv_number ON public.goods_received_notes
  FOR EACH ROW EXECUTE FUNCTION public.require_manual_grv_number();
