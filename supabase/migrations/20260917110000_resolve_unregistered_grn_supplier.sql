-- Resolve an approved GRN captured against an unregistered supplier before Sage retry.
CREATE OR REPLACE FUNCTION public.complete_missing_supplier_sage_code(
  p_grn_id uuid,
  p_supplier_code text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grn public.goods_received_notes%ROWTYPE;
  v_sync public.sync_log%ROWTYPE;
  v_code text := upper(btrim(p_supplier_code));
  v_supplier_id uuid;
  v_supplier_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'finance')
  ) THEN
    RAISE EXCEPTION 'Only Finance or Admin can complete the Sage supplier code';
  END IF;

  IF v_code IS NULL OR v_code !~ '^[A-Z0-9][A-Z0-9 ._/-]{1,49}$' OR v_code !~ '[A-Z0-9]$' THEN
    RAISE EXCEPTION 'Enter a valid Sage supplier code';
  END IF;

  SELECT * INTO v_grn FROM public.goods_received_notes
  WHERE id = p_grn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GRN not found'; END IF;
  IF v_grn.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved GRNs can be corrected here';
  END IF;

  SELECT * INTO v_sync FROM public.sync_log
  WHERE reference_id = p_grn_id AND event_type = 'grn_confirmed'
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No Sage posting found'; END IF;
  IF v_sync.status <> 'failed'
     OR coalesce(v_sync.message, '') NOT ILIKE '%No Sage supplier code%' THEN
    RAISE EXCEPTION 'This correction is only available for a missing Sage supplier code failure';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sync_log
    WHERE reference_id = p_grn_id AND event_type = 'grn_confirmed'
      AND status IN ('success', 'processing', 'pending', 'retry')
  ) THEN
    RAISE EXCEPTION 'This GRN has a successful or active Sage posting; refresh its status';
  END IF;

  v_supplier_name := nullif(btrim(coalesce(v_grn.unregistered_supplier_name, '')), '');
  IF v_grn.supplier_id IS NOT NULL THEN
    v_supplier_id := v_grn.supplier_id;
  ELSIF v_supplier_name IS NOT NULL THEN
    SELECT id INTO v_supplier_id FROM public.suppliers
    WHERE upper(btrim(name)) = upper(v_supplier_name)
    ORDER BY is_active DESC, created_at
    LIMIT 1;
  END IF;

  IF v_supplier_id IS NULL THEN
    IF v_supplier_name IS NULL THEN
      RAISE EXCEPTION 'This GRN has no linked supplier or supplier name';
    END IF;
    INSERT INTO public.suppliers (name, code, sage_code, is_active)
    VALUES (v_supplier_name, v_code, v_code, true)
    RETURNING id INTO v_supplier_id;
  ELSE
    UPDATE public.suppliers
    SET sage_code = v_code, updated_at = now()
    WHERE id = v_supplier_id;
  END IF;

  UPDATE public.goods_received_notes
  SET supplier_id = v_supplier_id, updated_at = now()
  WHERE id = p_grn_id;

  INSERT INTO public.approval_history
    (entity_type, entity_id, action, previous_status, new_status, approved_by, comments)
  VALUES ('grn', p_grn_id, 'supplier_reference_corrected', v_grn.status, v_grn.status,
    auth.uid(), 'Sage supplier code completed: ' || v_code ||
    CASE WHEN v_grn.supplier_id IS NULL THEN '; unregistered supplier linked to supplier master' ELSE '' END ||
    '. Sage retry remains a separate action.');

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_missing_supplier_sage_code(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_missing_supplier_sage_code(uuid, text) TO authenticated;
