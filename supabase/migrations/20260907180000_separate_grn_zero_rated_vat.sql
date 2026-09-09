-- Finance policy: No VAT is always Exempt. Zero Rated is a separate tax choice.
ALTER TABLE public.goods_received_notes
  DROP CONSTRAINT IF EXISTS goods_received_notes_vat_mode_check;

ALTER TABLE public.goods_received_notes
  ADD CONSTRAINT goods_received_notes_vat_mode_check
  CHECK (vat_mode IN ('pending_finance', 'exclusive', 'inclusive', 'no_vat', 'zero_rated'));

DROP FUNCTION IF EXISTS public.record_grn_vat_review(uuid, text, text);

CREATE FUNCTION public.record_grn_vat_review(
  p_grn_id uuid,
  p_vat_mode text,
  p_no_vat_treatment text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'finance', 'accountant']) THEN
    RAISE EXCEPTION 'Only Finance, Accountant, or Admin users can review GRN VAT.';
  END IF;
  IF p_vat_mode NOT IN ('exclusive', 'inclusive', 'no_vat', 'zero_rated') THEN
    RAISE EXCEPTION 'VAT mode is invalid.';
  END IF;
  IF (p_vat_mode = 'no_vat' AND p_no_vat_treatment <> 'exempt')
     OR (p_vat_mode = 'zero_rated' AND p_no_vat_treatment <> 'zero_rated')
     OR (p_vat_mode IN ('exclusive', 'inclusive') AND p_no_vat_treatment IS NOT NULL) THEN
    RAISE EXCEPTION 'VAT classification does not match the selected treatment.';
  END IF;

  UPDATE public.goods_received_notes SET
    vat_mode = p_vat_mode,
    vat_treatment = CASE WHEN p_vat_mode = 'no_vat' THEN 'exempt' WHEN p_vat_mode = 'zero_rated' THEN 'zero_rated' ELSE 'taxable' END,
    vat_tax_type_id = CASE WHEN p_vat_mode = 'no_vat' THEN 7 WHEN p_vat_mode = 'zero_rated' THEN 6 ELSE 9 END,
    vat_code = CASE WHEN p_vat_mode = 'no_vat' THEN '03' WHEN p_vat_mode = 'zero_rated' THEN '02' ELSE '515' END,
    vat_rate = CASE WHEN p_vat_mode IN ('no_vat', 'zero_rated') THEN 0 ELSE 15.5 END,
    vat_reviewed_by = auth.uid(), vat_reviewed_at = now(), updated_at = now()
  WHERE id = p_grn_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a pending GRN can receive a Finance VAT review.'; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_grn_vat_review(uuid, text, text) TO authenticated, service_role;
