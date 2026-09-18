CREATE TABLE IF NOT EXISTS public.grn_supplier_correction_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid NOT NULL REFERENCES public.goods_received_notes(id),
  corrected_by uuid NOT NULL REFERENCES public.profiles(id),
  previous_supplier_id uuid REFERENCES public.suppliers(id),
  new_supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.grn_supplier_correction_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance can read GRN supplier correction audit" ON public.grn_supplier_correction_audit;
CREATE POLICY "Finance can read GRN supplier correction audit"
  ON public.grn_supplier_correction_audit
  FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'finance', 'accountant']));

CREATE OR REPLACE FUNCTION public.correct_failed_grn_supplier(
  p_grn_id uuid,
  p_supplier_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grn public.goods_received_notes%ROWTYPE;
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Only an Admin can correct the supplier on a failed GRN.';
  END IF;

  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A correction reason is required.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id AND is_active = true) THEN
    RAISE EXCEPTION 'The selected supplier is not active or does not exist.';
  END IF;

  SELECT * INTO v_grn
  FROM public.goods_received_notes
  WHERE id = p_grn_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GRN % was not found.', p_grn_id;
  END IF;

  IF v_grn.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved GRN can use this correction.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sync_log
    WHERE event_type = 'grn_confirmed'
      AND reference_type = 'goods_received_notes'
      AND reference_id = p_grn_id
      AND status = 'failed'
  ) THEN
    RAISE EXCEPTION 'The GRN does not have a failed Sage posting that can be corrected.';
  END IF;

  INSERT INTO public.grn_supplier_correction_audit (
    grn_id, corrected_by, previous_supplier_id, new_supplier_id, reason
  ) VALUES (
    v_grn.id, auth.uid(), v_grn.supplier_id, p_supplier_id, btrim(p_reason)
  );

  UPDATE public.goods_received_notes
  SET supplier_id = p_supplier_id,
      updated_at = now()
  WHERE id = p_grn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.correct_failed_grn_supplier(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_failed_grn_supplier(uuid, uuid, text) TO authenticated;
