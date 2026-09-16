-- Allow Finance to reverse material transfers that are still in the buffer.
-- The function continues to require the authenticated user to match p_reversed_by.
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
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'finance')
  ) THEN
    RAISE EXCEPTION 'Only an administrator or Finance user can reverse a material transfer';
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
  SET status = 'rejected', rejection_reason = COALESCE(NULLIF(p_reason, ''), 'Reversed by administrator or Finance'),
      reversed_by = p_reversed_by, reversed_at = now(), updated_at = now()
  WHERE id = p_transfer_id;
  RETURN 'reversed';
END;
$$;

GRANT EXECUTE ON FUNCTION public.reverse_material_transfer(uuid, uuid, text) TO authenticated, service_role;
