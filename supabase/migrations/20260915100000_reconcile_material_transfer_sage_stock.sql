-- Use Sage RM stock as the authority for transfers while preserving the
-- internal Buffer ledger. This prevents missing internal RM rows from being
-- reported as zero stock and makes transfer references collision-safe.

CREATE OR REPLACE FUNCTION public.create_material_transfer_to_buffer(
  p_raw_material_id uuid, p_from_warehouse_id uuid, p_quantity numeric,
  p_unit text, p_transfer_date date, p_purpose text, p_notes text,
  p_production_order_id uuid, p_requested_by uuid, p_transfer_batch_key uuid
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_transfer_id uuid;
  v_buffer_warehouse_id uuid;
  v_sage_balance numeric;
  v_buffer_balance numeric;
  v_available numeric;
  v_transfer_number text;
  v_attempt integer := 0;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_requested_by THEN
    RAISE EXCEPTION 'Authenticated user must request the transfer';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Transfer quantity must be greater than zero';
  END IF;
  IF p_transfer_batch_key IS NULL THEN
    RAISE EXCEPTION 'Transfer batch key is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'md', 'production_manager', 'supervisor',
                   'warehouse_manager', 'warehouse_clerk', 'raw_material_manager',
                   'rm_manager', 'logistics')
  ) THEN
    RAISE EXCEPTION 'This role cannot create material transfers';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.material_transfers
    WHERE transfer_batch_key = p_transfer_batch_key
      AND raw_material_id = p_raw_material_id
      AND status IN ('in_buffer', 'approved', 'in_transit', 'received')
  ) THEN
    RAISE EXCEPTION 'This raw material has already been picked up in this transfer. Enter it once and combine the quantity.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses
    WHERE id = p_from_warehouse_id AND upper(code) = 'RM' AND is_active
  ) THEN
    RAISE EXCEPTION 'Transfers must originate from the active RM warehouse';
  END IF;

  SELECT id INTO v_buffer_warehouse_id FROM public.warehouses
  WHERE upper(code) = 'BUFFER' AND is_active LIMIT 1;
  IF v_buffer_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Active BUFFER warehouse not found';
  END IF;

  -- Sage RM includes stock already represented in the MES Buffer. Therefore
  -- only Sage RM minus current Buffer is transferable from RM.
  SELECT quantity INTO v_sage_balance
  FROM public.sage_stock_balances
  WHERE raw_material_id = p_raw_material_id AND warehouse_id = 18
  FOR UPDATE;
  IF v_sage_balance IS NULL THEN
    RAISE EXCEPTION 'No Sage RM balance is available for this material. Refresh Sage stock and retry.';
  END IF;
  SELECT COALESCE(quantity, 0) INTO v_buffer_balance
  FROM public.warehouse_stock_balances
  WHERE raw_material_id = p_raw_material_id
    AND warehouse_id = v_buffer_warehouse_id
  FOR UPDATE;
  v_available := v_sage_balance - COALESCE(v_buffer_balance, 0);
  IF v_available < p_quantity THEN
    RAISE EXCEPTION 'Insufficient Sage RM stock available for transfer. Available: %, Required: %',
      GREATEST(v_available, 0), p_quantity;
  END IF;

  -- Reconcile the touched RM row before moving stock so missing rows never
  -- become negative just because Sage is the source of truth.
  INSERT INTO public.warehouse_stock_balances
    (raw_material_id, warehouse_id, quantity, updated_at)
  VALUES (p_raw_material_id, p_from_warehouse_id, v_available - p_quantity, now())
  ON CONFLICT (raw_material_id, warehouse_id)
  DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();
  PERFORM public.update_warehouse_balance(p_raw_material_id, v_buffer_warehouse_id, p_quantity);

  -- The legacy default uses only three random digits and can collide.
  LOOP
    v_transfer_number := 'MT-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-' ||
      lpad((floor(random() * 900000) + 100000)::text, 6, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.material_transfers WHERE transfer_number = v_transfer_number
    );
    v_attempt := v_attempt + 1;
    IF v_attempt > 10 THEN
      RAISE EXCEPTION 'Could not generate a unique transfer reference. Please retry.';
    END IF;
  END LOOP;

  INSERT INTO public.material_transfers (
    transfer_number, raw_material_id, from_warehouse_id, buffer_warehouse_id,
    quantity, unit, transfer_date, purpose, notes, production_order_id, status,
    requested_by, buffer_approved_by, buffer_approved_at, transfer_batch_key
  ) VALUES (
    v_transfer_number, p_raw_material_id, p_from_warehouse_id, v_buffer_warehouse_id,
    p_quantity, COALESCE(NULLIF(p_unit, ''), 'kg'), COALESCE(p_transfer_date, CURRENT_DATE),
    COALESCE(p_purpose, ''), COALESCE(p_notes, ''), p_production_order_id, 'in_buffer',
    p_requested_by, p_requested_by, now(), p_transfer_batch_key
  ) RETURNING id INTO v_transfer_id;

  INSERT INTO public.stock_movements (
    movement_type, reference_type, reference_id, raw_material_id, warehouse_id,
    quantity, unit, movement_date, performed_by, notes
  ) VALUES (
    'transfer', 'material_transfer', v_transfer_id, p_raw_material_id,
    v_buffer_warehouse_id, p_quantity, COALESCE(NULLIF(p_unit, ''), 'kg'),
    now(), p_requested_by, 'Step 1: RM to Production Buffer (Sage balance reconciled)'
  );
  RETURN v_transfer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_material_transfer_to_buffer(uuid, uuid, numeric, text, date, text, text, uuid, uuid, uuid) TO authenticated, service_role;
