-- Repair the Production material-transfer workflow.
-- RM -> BUFFER is created here; BUFFER -> PRODUCTION is accepted by the
-- production receiver RPC and then queued for the Sage SDK bridge.

CREATE OR REPLACE FUNCTION public.update_warehouse_balance(
  p_raw_material_id uuid,
  p_warehouse_id uuid,
  p_delta numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.warehouse_stock_balances (raw_material_id, warehouse_id, quantity, updated_at)
  VALUES (p_raw_material_id, p_warehouse_id, p_delta, now())
  ON CONFLICT (raw_material_id, warehouse_id)
  DO UPDATE SET quantity = warehouse_stock_balances.quantity + EXCLUDED.quantity,
                updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.create_material_transfer_to_buffer(
  p_raw_material_id uuid,
  p_from_warehouse_id uuid,
  p_quantity numeric,
  p_unit text,
  p_transfer_date date,
  p_purpose text,
  p_notes text,
  p_production_order_id uuid,
  p_requested_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer_id uuid;
  v_buffer_warehouse_id uuid;
  v_rm_balance numeric;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_requested_by THEN
    RAISE EXCEPTION 'Authenticated user must request the transfer';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Transfer quantity must be greater than zero';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'md', 'production_manager', 'supervisor',
                   'warehouse_manager', 'raw_material_manager', 'rm_manager', 'logistics')
  ) THEN
    RAISE EXCEPTION 'This role cannot create material transfers';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses
    WHERE id = p_from_warehouse_id AND upper(code) = 'RM' AND is_active
  ) THEN
    RAISE EXCEPTION 'Transfers must originate from the active RM warehouse';
  END IF;

  SELECT id INTO v_buffer_warehouse_id
  FROM public.warehouses
  WHERE upper(code) = 'BUFFER' AND is_active
  LIMIT 1;

  IF v_buffer_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Active BUFFER warehouse not found';
  END IF;

  SELECT COALESCE(quantity, 0) INTO v_rm_balance
  FROM public.warehouse_stock_balances
  WHERE raw_material_id = p_raw_material_id
    AND warehouse_id = p_from_warehouse_id
  FOR UPDATE;

  IF COALESCE(v_rm_balance, 0) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock in RM Warehouse. Available: %, Required: %',
      COALESCE(v_rm_balance, 0), p_quantity;
  END IF;

  PERFORM public.update_warehouse_balance(p_raw_material_id, p_from_warehouse_id, -p_quantity);
  PERFORM public.update_warehouse_balance(p_raw_material_id, v_buffer_warehouse_id, p_quantity);

  INSERT INTO public.material_transfers (
    raw_material_id, from_warehouse_id, buffer_warehouse_id, quantity, unit,
    transfer_date, purpose, notes, production_order_id, status,
    requested_by, buffer_approved_by, buffer_approved_at
  ) VALUES (
    p_raw_material_id, p_from_warehouse_id, v_buffer_warehouse_id, p_quantity,
    COALESCE(NULLIF(p_unit, ''), 'kg'), COALESCE(p_transfer_date, CURRENT_DATE),
    COALESCE(p_purpose, ''), COALESCE(p_notes, ''), p_production_order_id,
    'in_buffer', p_requested_by, p_requested_by, now()
  ) RETURNING id INTO v_transfer_id;

  INSERT INTO public.stock_movements (
    movement_type, reference_type, reference_id, raw_material_id, warehouse_id,
    quantity, unit, movement_date, performed_by, notes
  ) VALUES (
    'transfer', 'material_transfer', v_transfer_id, p_raw_material_id,
    v_buffer_warehouse_id, p_quantity, COALESCE(NULLIF(p_unit, ''), 'kg'),
    now(), p_requested_by, 'Step 1: RM to Production Buffer'
  );

  RETURN v_transfer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_material_transfer_to_production(
  p_transfer_id uuid, p_approved_by uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer record;
  v_buffer_balance numeric;
  v_production_warehouse_id uuid;
  v_existing_production_movement boolean;
  v_recovered boolean := false;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_approved_by THEN
    RAISE EXCEPTION 'Authenticated user must approve the receipt';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'md', 'production_manager', 'supervisor',
                   'logistics', 'finance', 'accountant', 'production_receiver')
  ) THEN
    RAISE EXCEPTION 'This role cannot receive material transfers into Production';
  END IF;

  SELECT * INTO v_transfer FROM public.material_transfers
  WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found: %', p_transfer_id; END IF;

  SELECT id INTO v_production_warehouse_id FROM public.warehouses
  WHERE upper(code) = 'PRODUCTION' AND is_active LIMIT 1;
  IF v_production_warehouse_id IS NULL THEN RAISE EXCEPTION 'Production Warehouse not found'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE reference_type = 'material_transfer'
      AND reference_id = p_transfer_id
      AND movement_type = 'production_input'
      AND quantity = v_transfer.quantity
      AND raw_material_id = v_transfer.raw_material_id
  ) INTO v_existing_production_movement;

  IF v_transfer.status = 'received' OR v_existing_production_movement THEN
    v_recovered := true;
    UPDATE public.material_transfers
    SET status = 'received', production_approved_by = p_approved_by,
        production_approved_at = COALESCE(production_approved_at, now()),
        approved_by = p_approved_by, approved_at = COALESCE(approved_at, now()), updated_at = now()
    WHERE id = p_transfer_id;
  ELSE
    IF v_transfer.status <> 'in_buffer' THEN
      RAISE EXCEPTION 'Transfer must be in in_buffer status. Current status: %', v_transfer.status;
    END IF;

    SELECT COALESCE(quantity, 0) INTO v_buffer_balance
    FROM public.warehouse_stock_balances
    WHERE raw_material_id = v_transfer.raw_material_id
      AND warehouse_id = v_transfer.buffer_warehouse_id FOR UPDATE;

    IF COALESCE(v_buffer_balance, 0) < v_transfer.quantity THEN
      RAISE EXCEPTION 'Insufficient stock in Buffer Warehouse. Available: %, Required: %',
        COALESCE(v_buffer_balance, 0), v_transfer.quantity;
    END IF;

    PERFORM public.update_warehouse_balance(v_transfer.raw_material_id,
                                             v_transfer.buffer_warehouse_id,
                                             -v_transfer.quantity);
    PERFORM public.update_warehouse_balance(v_transfer.raw_material_id,
                                             v_production_warehouse_id,
                                             v_transfer.quantity);

    INSERT INTO public.stock_movements (
      raw_material_id, movement_type, quantity, warehouse_id,
      reference_type, reference_id, notes, performed_by
    ) VALUES (
      v_transfer.raw_material_id, 'production_input', v_transfer.quantity,
      v_production_warehouse_id, 'material_transfer', p_transfer_id,
      'Step 2: Transfer from Buffer to Production Floor', p_approved_by
    );

    UPDATE public.material_transfers
    SET status = 'received', production_approved_by = p_approved_by,
        production_approved_at = now(), approved_by = p_approved_by,
        approved_at = now(), updated_at = now()
    WHERE id = p_transfer_id;
  END IF;

  INSERT INTO public.sync_log (event_type, reference_type, reference_id, status, message, details)
  SELECT 'material_transfer_to_production', 'material_transfer', p_transfer_id,
         'pending', 'Production material transfer received',
         jsonb_build_object('quantity', v_transfer.quantity, 'unit', v_transfer.unit)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.sync_log
    WHERE event_type = 'material_transfer_to_production'
      AND reference_id = p_transfer_id
      AND status IN ('pending', 'processing', 'success')
  );

  RETURN CASE WHEN v_recovered THEN 'already_received' ELSE 'processed' END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_warehouse_balance(uuid, uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_material_transfer_to_buffer(uuid, uuid, numeric, text, date, text, text, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_material_transfer_to_production(uuid, uuid) TO authenticated, service_role;
