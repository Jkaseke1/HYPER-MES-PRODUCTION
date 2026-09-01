-- Finance owns the VAT basis for raw-material GRNs. Capture is deliberately
-- separate from Sage posting so the tax decision is auditable before a GRV is sent.

ALTER TABLE public.goods_received_notes
  ADD COLUMN IF NOT EXISTS vat_mode text NOT NULL DEFAULT 'pending_finance',
  ADD COLUMN IF NOT EXISTS vat_tax_type_id integer,
  ADD COLUMN IF NOT EXISTS vat_code text,
  ADD COLUMN IF NOT EXISTS vat_rate numeric(7,4),
  ADD COLUMN IF NOT EXISTS vat_reviewed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS vat_reviewed_at timestamptz;

ALTER TABLE public.goods_received_notes
  DROP CONSTRAINT IF EXISTS goods_received_notes_vat_mode_check;

ALTER TABLE public.goods_received_notes
  ADD CONSTRAINT goods_received_notes_vat_mode_check
  CHECK (vat_mode IN ('pending_finance', 'exclusive', 'inclusive', 'no_vat'));

CREATE OR REPLACE FUNCTION public.record_grn_vat_review(
  p_grn_id uuid,
  p_vat_mode text
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

  UPDATE public.goods_received_notes
  SET
    vat_mode = p_vat_mode,
    vat_tax_type_id = CASE WHEN p_vat_mode = 'no_vat' THEN NULL ELSE 9 END,
    vat_code = CASE WHEN p_vat_mode = 'no_vat' THEN NULL ELSE '515' END,
    vat_rate = CASE WHEN p_vat_mode = 'no_vat' THEN 0 ELSE 15.5 END,
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

REVOKE ALL ON FUNCTION public.record_grn_vat_review(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_grn_vat_review(uuid, text) TO authenticated, service_role;
