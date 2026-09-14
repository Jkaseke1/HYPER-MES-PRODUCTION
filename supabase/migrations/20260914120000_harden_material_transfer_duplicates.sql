-- Prevent duplicate lines in one transfer bundle and provide an audited,
-- admin-only reversal for transfers that were moved into the buffer by mistake.

ALTER TABLE public.material_transfers
  ADD COLUMN IF NOT EXISTS transfer_batch_key uuid,
  ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz;

ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN ('receipt', 'issue', 'transfer', 'adjustment', 'production_input', 'production_output', 'dispatch'));

CREATE INDEX IF NOT EXISTS idx_material_transfers_batch_key
  ON public.material_transfers(transfer_batch_key, raw_material_id);

CREATE OR REPLACE FUNCTION public.create_material_transfer_to_buffer(
  p_raw_material_id uuid, p_from_warehouse_id uuid, p_quantity numeric,
  p_unit text, p_transfer_date date, p_purpose text, p_notes text,
  p_production_order_id uuid, p_requested_by uuid, p_transfer_batch_key uuid
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  SELECT COALESCE(quantity, 0) INTO v_rm_balance
  FROM public.warehouse_stock_balances
  WHERE raw_material_id = p_raw_material_id
    AND warehouse_id = p_from_warehouse_id FOR UPDATE;
  IF COALESCE(v_rm_balance, 0) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock in RM Warehouse. Available: %, Required: %',
      COALESCE(v_rm_balance, 0), p_quantity;
  END IF;
  PERFORM public.update_warehouse_balance(p_raw_material_id, p_from_warehouse_id, -p_quantity);
  PERFORM public.update_warehouse_balance(p_raw_material_id, v_buffer_warehouse_id, p_quantity);
  INSERT INTO public.material_transfers (
    raw_material_id, from_warehouse_id, buffer_warehouse_id, quantity, unit,
    transfer_date, purpose, notes, production_order_id, status,
    requested_by, buffer_approved_by, buffer_approved_at, transfer_batch_key
  ) VALUES (
    p_raw_material_id, p_from_warehouse_id, v_buffer_warehouse_id, p_quantity,
    COALESCE(NULLIF(p_unit, ''), 'kg'), COALESCE(p_transfer_date, CURRENT_DATE),
    COALESCE(p_purpose, ''), COALESCE(p_notes, ''), p_production_order_id,
    'in_buffer', p_requested_by, p_requested_by, now(), p_transfer_batch_key
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

CREATE OR REPLACE FUNCTION public.reverse_material_transfer(
  p_transfer_id uuid, p_reversed_by uuid, p_reason text
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_transfer public.material_transfers%ROWTYPE;
  v_buffer_balance numeric;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_reversed_by THEN
    RAISE EXCEPTION 'Authenticated user must reverse the transfer';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only an administrator can reverse a material transfer';
  END IF;

  SELECT * INTO v_transfer FROM public.material_transfers
  WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found: %', p_transfer_id; END IF;
  IF v_transfer.status <> 'in_buffer' THEN
    RAISE EXCEPTION 'Only transfers still in Buffer can be reversed here. Current status: %', v_transfer.status;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE reference_type = 'material_transfer'
      AND reference_id = p_transfer_id
      AND notes ILIKE 'Reversal:%'
  ) THEN
    RAISE EXCEPTION 'This transfer has already been reversed';
  END IF;

  SELECT COALESCE(quantity, 0) INTO v_buffer_balance
  FROM public.warehouse_stock_balances
  WHERE raw_material_id = v_transfer.raw_material_id
    AND warehouse_id = v_transfer.buffer_warehouse_id FOR UPDATE;
  IF COALESCE(v_buffer_balance, 0) < v_transfer.quantity THEN
    RAISE EXCEPTION 'Insufficient Buffer stock to reverse this transfer. Available: %, Required: %',
      COALESCE(v_buffer_balance, 0), v_transfer.quantity;
  END IF;

  PERFORM public.update_warehouse_balance(v_transfer.raw_material_id, v_transfer.buffer_warehouse_id, -v_transfer.quantity);
  PERFORM public.update_warehouse_balance(v_transfer.raw_material_id, v_transfer.from_warehouse_id, v_transfer.quantity);

  INSERT INTO public.stock_movements (
    movement_type, reference_type, reference_id, raw_material_id, warehouse_id,
    quantity, unit, movement_date, performed_by, notes
  ) VALUES
    ('adjustment', 'material_transfer', p_transfer_id, v_transfer.raw_material_id,
     v_transfer.buffer_warehouse_id, -v_transfer.quantity, v_transfer.unit, now(),
     p_reversed_by, 'Reversal: removed duplicate from Production Buffer'),
    ('adjustment', 'material_transfer', p_transfer_id, v_transfer.raw_material_id,
     v_transfer.from_warehouse_id, v_transfer.quantity, v_transfer.unit, now(),
     p_reversed_by, 'Reversal: returned duplicate to RM Warehouse');

  UPDATE public.material_transfers
  SET status = 'rejected', rejection_reason = COALESCE(NULLIF(p_reason, ''), 'Reversed by administrator'),
      reversed_by = p_reversed_by, reversed_at = now(), updated_at = now()
  WHERE id = p_transfer_id;
  RETURN 'reversed';
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_material_transfer_to_buffer(uuid, uuid, numeric, text, date, text, text, uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverse_material_transfer(uuid, uuid, text) TO authenticated, service_role;
