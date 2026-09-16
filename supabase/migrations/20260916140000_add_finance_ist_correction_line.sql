-- Add a missing material as a new audited line under an existing HFIST reference.
CREATE OR REPLACE FUNCTION public.add_material_transfer_line_to_ist(
  p_existing_transfer_id uuid,
  p_raw_material_id uuid,
  p_quantity numeric,
  p_requested_by uuid
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_parent public.material_transfers%ROWTYPE;
  v_material public.raw_materials%ROWTYPE;
  v_buffer_warehouse_id uuid;
  v_sage_balance numeric;
  v_buffer_balance numeric;
  v_available numeric;
  v_transfer_number text;
  v_transfer_id uuid;
  v_attempt integer := 0;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_requested_by THEN
    RAISE EXCEPTION 'Authenticated user must add the IST correction line';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'finance')
  ) THEN
    RAISE EXCEPTION 'Only an administrator or Finance user can add an IST correction line';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  SELECT * INTO v_parent
  FROM public.material_transfers
  WHERE id = p_existing_transfer_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original transfer not found'; END IF;
  IF v_parent.status <> 'in_buffer' THEN
    RAISE EXCEPTION 'Only transfers still in Buffer can receive an IST correction line';
  END IF;
  IF COALESCE(v_parent.purpose, '') !~* '^HFIST[0-9]+$' THEN
    RAISE EXCEPTION 'The original transfer does not have a valid HFIST reference';
  END IF;
  IF v_parent.transfer_batch_key IS NULL THEN
    RAISE EXCEPTION 'This transfer has no IST batch key and cannot receive a correction line';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.material_transfers
    WHERE transfer_batch_key = v_parent.transfer_batch_key
      AND raw_material_id = p_raw_material_id
      AND status IN ('in_buffer', 'approved', 'in_transit', 'received')
  ) THEN
    RAISE EXCEPTION 'This material already exists under the same IST. Combine the quantity instead.';
  END IF;

  SELECT * INTO v_material FROM public.raw_materials
  WHERE id = p_raw_material_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active raw material not found'; END IF;

  SELECT id INTO v_buffer_warehouse_id FROM public.warehouses
  WHERE upper(code) = 'BUFFER' AND is_active LIMIT 1;
  IF v_buffer_warehouse_id IS NULL THEN RAISE EXCEPTION 'Active BUFFER warehouse not found'; END IF;

  SELECT quantity INTO v_sage_balance
  FROM public.sage_stock_balances
  WHERE raw_material_id = p_raw_material_id AND warehouse_id = 18
  FOR UPDATE;
  IF v_sage_balance IS NULL THEN
    RAISE EXCEPTION 'No Sage RM balance is available for this material';
  END IF;
  SELECT COALESCE(quantity, 0) INTO v_buffer_balance
  FROM public.warehouse_stock_balances
  WHERE raw_material_id = p_raw_material_id AND warehouse_id = v_buffer_warehouse_id
  FOR UPDATE;
  v_available := v_sage_balance - COALESCE(v_buffer_balance, 0);
  IF v_available < p_quantity THEN
    RAISE EXCEPTION 'Insufficient Sage RM stock available. Available: %, Required: %', GREATEST(v_available, 0), p_quantity;
  END IF;

  INSERT INTO public.warehouse_stock_balances (raw_material_id, warehouse_id, quantity, updated_at)
  VALUES (p_raw_material_id, v_parent.from_warehouse_id, v_available - p_quantity, now())
  ON CONFLICT (raw_material_id, warehouse_id)
  DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();
  PERFORM public.update_warehouse_balance(p_raw_material_id, v_buffer_warehouse_id, p_quantity);

  LOOP
    v_transfer_number := 'MT-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-' ||
      lpad((floor(random() * 900000) + 100000)::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.material_transfers WHERE transfer_number = v_transfer_number);
    v_attempt := v_attempt + 1;
    IF v_attempt > 10 THEN RAISE EXCEPTION 'Could not generate a unique transfer reference'; END IF;
  END LOOP;

  INSERT INTO public.material_transfers (
    transfer_number, raw_material_id, from_warehouse_id, buffer_warehouse_id,
    quantity, unit, transfer_date, purpose, notes, production_order_id, status,
    requested_by, buffer_approved_by, buffer_approved_at, transfer_batch_key
  ) VALUES (
    v_transfer_number, p_raw_material_id, v_parent.from_warehouse_id, v_buffer_warehouse_id,
    p_quantity, COALESCE(NULLIF(v_material.unit, ''), 'kg'), v_parent.transfer_date,
    v_parent.purpose, COALESCE(v_parent.notes, '') || ' | IST correction line added by Finance/Admin',
    v_parent.production_order_id, 'in_buffer', p_requested_by, p_requested_by, now(), v_parent.transfer_batch_key
  ) RETURNING id INTO v_transfer_id;

  INSERT INTO public.stock_movements (
    movement_type, reference_type, reference_id, raw_material_id, warehouse_id,
    quantity, unit, movement_date, performed_by, notes
  ) VALUES (
    'transfer', 'material_transfer', v_transfer_id, p_raw_material_id, v_buffer_warehouse_id,
    p_quantity, COALESCE(NULLIF(v_material.unit, ''), 'kg'), now(), p_requested_by,
    'IST correction line: RM to Production Buffer'
  );
  RETURN v_transfer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_material_transfer_line_to_ist(uuid, uuid, numeric, uuid) TO authenticated, service_role;
