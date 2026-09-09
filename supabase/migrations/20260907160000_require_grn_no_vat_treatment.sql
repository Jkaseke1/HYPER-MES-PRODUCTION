-- Keep Finance's zero-rated and exempt decisions distinct before Sage posting.

ALTER TABLE public.goods_received_notes
  ADD COLUMN IF NOT EXISTS vat_treatment text;

ALTER TABLE public.goods_received_notes
  DROP CONSTRAINT IF EXISTS goods_received_notes_vat_treatment_check;

ALTER TABLE public.goods_received_notes
  ADD CONSTRAINT goods_received_notes_vat_treatment_check
  CHECK (vat_treatment IS NULL OR vat_treatment IN ('taxable', 'zero_rated', 'exempt'));

DROP FUNCTION IF EXISTS public.record_grn_vat_review(uuid, text);

CREATE FUNCTION public.record_grn_vat_review(
  p_grn_id uuid,
  p_vat_mode text,
  p_no_vat_treatment text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'finance', 'accountant']) THEN
    RAISE EXCEPTION 'Only Finance, Accountant, or Admin users can review GRN VAT.';
  END IF;

  IF p_vat_mode NOT IN ('exclusive', 'inclusive', 'no_vat') THEN
    RAISE EXCEPTION 'VAT mode must be exclusive, inclusive, or no_vat.';
  END IF;

  IF p_vat_mode = 'no_vat' AND p_no_vat_treatment NOT IN ('zero_rated', 'exempt') THEN
    RAISE EXCEPTION 'No-VAT GRNs must be classified as zero-rated or exempt.';
  END IF;

  IF p_vat_mode <> 'no_vat' AND p_no_vat_treatment IS NOT NULL THEN
    RAISE EXCEPTION 'A no-VAT treatment can only be selected for no-VAT GRNs.';
  END IF;

  UPDATE public.goods_received_notes
  SET
    vat_mode = p_vat_mode,
    vat_treatment = CASE
      WHEN p_vat_mode = 'no_vat' THEN p_no_vat_treatment
      ELSE 'taxable'
    END,
    vat_tax_type_id = CASE
      WHEN p_vat_mode IN ('exclusive', 'inclusive') THEN 9
      WHEN p_no_vat_treatment = 'zero_rated' THEN 6
      WHEN p_no_vat_treatment = 'exempt' THEN 7
    END,
    vat_code = CASE
      WHEN p_vat_mode IN ('exclusive', 'inclusive') THEN '515'
      WHEN p_no_vat_treatment = 'zero_rated' THEN '02'
      WHEN p_no_vat_treatment = 'exempt' THEN '03'
    END,
    vat_rate = CASE
      WHEN p_vat_mode IN ('exclusive', 'inclusive') THEN 15.5
      ELSE 0
    END,
    vat_reviewed_by = auth.uid(),
    vat_reviewed_at = now(),
    updated_at = now()
  WHERE id = p_grn_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a pending GRN can receive a Finance VAT review.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_grn_vat_review(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_grn_vat_review(uuid, text, text) TO authenticated, service_role;
