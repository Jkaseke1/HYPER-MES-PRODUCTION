-- Make duplicate and reversed material-transfer controls database-enforced.

CREATE OR REPLACE FUNCTION public.reject_duplicate_material_transfer_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.transfer_batch_key IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.material_transfers
    WHERE transfer_batch_key = NEW.transfer_batch_key
      AND raw_material_id = NEW.raw_material_id
      AND id <> NEW.id
      AND status IN ('in_buffer', 'approved', 'in_transit', 'received')
  ) THEN
    RAISE EXCEPTION 'Duplicate material line in this IST is not allowed. Combine the quantity on one line.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_duplicate_material_transfer_line ON public.material_transfers;
CREATE TRIGGER trg_reject_duplicate_material_transfer_line
BEFORE INSERT ON public.material_transfers
FOR EACH ROW
EXECUTE FUNCTION public.reject_duplicate_material_transfer_line();

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
  IF v_transfer.reversed_by IS NOT NULL OR v_transfer.reversed_at IS NOT NULL
     OR v_transfer.status = 'rejected' THEN
    RAISE EXCEPTION 'Reversed material transfers cannot be approved or processed';
  END IF;
  IF v_transfer.transfer_batch_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.material_transfers sibling
    WHERE sibling.transfer_batch_key = v_transfer.transfer_batch_key
      AND sibling.raw_material_id = v_transfer.raw_material_id
      AND sibling.id <> v_transfer.id
      AND sibling.status IN ('in_buffer', 'approved', 'in_transit', 'received')
  ) THEN
    RAISE EXCEPTION 'Duplicate material line in this IST. Approval and Sage processing are blocked.';
  END IF;

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
    PERFORM public.update_warehouse_balance(v_transfer.raw_material_id, v_transfer.buffer_warehouse_id, -v_transfer.quantity);
    PERFORM public.update_warehouse_balance(v_transfer.raw_material_id, v_production_warehouse_id, v_transfer.quantity);
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

GRANT EXECUTE ON FUNCTION public.reject_duplicate_material_transfer_line() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_material_transfer_to_production(uuid, uuid) TO authenticated, service_role;
