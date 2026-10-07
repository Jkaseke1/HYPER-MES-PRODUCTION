-- Add the Sage-verified Sodium Salinomycin stock master to the MES
-- weighbridge product list. Sage stock code SOD0001 was verified in the
-- live Hyperfeeds 2024 StkItem master on 2026-10-07.
INSERT INTO public.raw_materials (
  name, code, sage_code, category, unit, current_stock, reorder_level,
  warehouse_id, description, is_active
)
SELECT
  'Salinomycin',
  'SALINOMYCIN',
  'SOD0001',
  'additive',
  'kg',
  0,
  0,
  w.id,
  'Sage item SOD0001: Sodium Salinomycin.',
  true
FROM public.warehouses w
WHERE upper(w.code) = 'RM'
  AND w.is_active
LIMIT 1
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    sage_code = EXCLUDED.sage_code,
    category = EXCLUDED.category,
    unit = EXCLUDED.unit,
    warehouse_id = COALESCE(public.raw_materials.warehouse_id, EXCLUDED.warehouse_id),
    description = EXCLUDED.description,
    is_active = true,
    updated_at = now();

-- The original GRN remains immutable. This date is the Finance-selected Sage
-- document date for the separate Return to Supplier transaction.
ALTER TABLE public.return_to_supplier_requests
  ADD COLUMN IF NOT EXISTS sage_transaction_date date;

CREATE OR REPLACE FUNCTION public.request_grn_return(
  p_grn_id uuid,
  p_lines jsonb,
  p_reason text,
  p_transaction_date date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_grn public.goods_received_notes%ROWTYPE;
  v_rts_id uuid;
  v_rts_number text;
  v_line jsonb;
  v_grn_item public.grn_items%ROWTYPE;
  v_quantity numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('finance', 'admin')
  ) THEN
    RAISE EXCEPTION 'Only Finance or Admin users can create an RTS.';
  END IF;
  IF NULLIF(BTRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A return reason is required.';
  END IF;
  IF p_transaction_date IS NULL THEN
    RAISE EXCEPTION 'A Sage RTS date is required.';
  END IF;
  IF p_transaction_date > current_date THEN
    RAISE EXCEPTION 'The Sage RTS date cannot be in the future.';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one return line is required.';
  END IF;

  SELECT * INTO v_grn
  FROM public.goods_received_notes
  WHERE id = p_grn_id
  FOR SHARE;

  IF NOT FOUND OR v_grn.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved GRNs can be returned to supplier.';
  END IF;
  IF p_transaction_date < v_grn.received_date THEN
    RAISE EXCEPTION 'The Sage RTS date cannot be before the original GRV receipt date.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sync_log
    WHERE event_type = 'grn_confirmed'
      AND reference_id = p_grn_id
      AND status = 'success'
  ) THEN
    RAISE EXCEPTION 'The GRN must be posted successfully to Sage before an RTS can be created.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.return_to_supplier_requests
    WHERE original_grn_id = p_grn_id
      AND status IN ('pending_finance', 'approved', 'processing', 'posted')
  ) THEN
    RAISE EXCEPTION 'An RTS already exists for this GRN.';
  END IF;

  v_rts_number := 'RTS-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  INSERT INTO public.return_to_supplier_requests (
    rts_number, original_grn_id, original_grn_number, supplier_id, warehouse_id,
    reason, sage_transaction_date, created_by
  ) VALUES (
    v_rts_number, v_grn.id, v_grn.grn_number, v_grn.supplier_id, v_grn.warehouse_id,
    BTRIM(p_reason), p_transaction_date, auth.uid()
  ) RETURNING id INTO v_rts_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_grn_item
    FROM public.grn_items
    WHERE id = (v_line->>'grn_item_id')::uuid
      AND grn_id = p_grn_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A selected return line does not belong to this GRN.';
    END IF;

    v_quantity := (v_line->>'quantity')::numeric;
    IF v_quantity IS NULL OR v_quantity <= 0 OR v_quantity > v_grn_item.received_qty THEN
      RAISE EXCEPTION 'Return quantity must be greater than zero and no more than the received quantity.';
    END IF;

    INSERT INTO public.return_to_supplier_items (
      rts_id, grn_item_id, raw_material_id, quantity, unit_cost, batch_number, expiry_date
    ) VALUES (
      v_rts_id, v_grn_item.id, v_grn_item.raw_material_id, v_quantity, v_grn_item.unit_cost,
      v_grn_item.batch_number, v_grn_item.expiry_date
    );
  END LOOP;

  RETURN v_rts_id;
END;
$$;

-- Preserve the former three-parameter RPC for already-deployed browser tabs.
CREATE OR REPLACE FUNCTION public.request_grn_return(
  p_grn_id uuid,
  p_lines jsonb,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_received_date date;
BEGIN
  SELECT received_date INTO v_received_date
  FROM public.goods_received_notes
  WHERE id = p_grn_id;

  RETURN public.request_grn_return(p_grn_id, p_lines, p_reason, COALESCE(v_received_date, current_date));
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_grn_return(uuid, jsonb, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_grn_return(uuid, jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
