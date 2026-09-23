-- An IST reference identifies one transfer bundle. Prevent a second active bundle
-- from being raised with the same HFIST number, including concurrent submissions.

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
  v_sage_synced_at timestamptz;
  v_buffer_balance numeric;
  v_available numeric;
  v_transfer_number text;
  v_ist_reference text;
  v_attempt integer := 0;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_requested_by THEN RAISE EXCEPTION 'Authenticated user must request the transfer'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Transfer quantity must be greater than zero'; END IF;
  IF p_transfer_batch_key IS NULL THEN RAISE EXCEPTION 'Transfer batch key is required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid()
      AND role IN ('admin', 'md', 'production_manager', 'supervisor', 'warehouse_manager', 'warehouse_clerk', 'raw_material_manager', 'rm_manager', 'logistics')
  ) THEN RAISE EXCEPTION 'This role cannot create material transfers'; END IF;

  v_ist_reference := upper(btrim(COALESCE(p_purpose, '')));
  IF v_ist_reference !~ '^HFIST[0-9]+$' THEN
    RAISE EXCEPTION 'IST reference must use the format HFIST followed by digits';
  END IF;

  -- Serialize bundle creation by IST reference so concurrent requests cannot pass
  -- the duplicate check at the same time. This lock exists only for this transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_ist_reference, 0));
  IF EXISTS (
    SELECT 1
    FROM material_transfers
    WHERE upper(btrim(COALESCE(purpose, ''))) = v_ist_reference
      AND transfer_batch_key IS DISTINCT FROM p_transfer_batch_key
      AND status <> 'rejected'
      AND reversed_by IS NULL
      AND reversed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'IST % already exists. Open the existing IST or add an approved correction line; a second IST with the same reference cannot be raised.', v_ist_reference;
  END IF;

  IF EXISTS (
    SELECT 1 FROM material_transfers
    WHERE transfer_batch_key = p_transfer_batch_key AND raw_material_id = p_raw_material_id
      AND status IN ('in_buffer', 'approved', 'in_transit', 'received')
  ) THEN RAISE EXCEPTION 'This raw material has already been picked up in this transfer. Enter it once and combine the quantity.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM warehouses WHERE id = p_from_warehouse_id AND upper(code) = 'RM' AND is_active) THEN
    RAISE EXCEPTION 'Transfers must originate from the active RM warehouse';
  END IF;

  SELECT id INTO v_buffer_warehouse_id FROM warehouses WHERE upper(code) = 'BUFFER' AND is_active LIMIT 1;
  IF v_buffer_warehouse_id IS NULL THEN RAISE EXCEPTION 'Active BUFFER warehouse not found'; END IF;

  SELECT quantity, last_synced_at INTO v_sage_balance, v_sage_synced_at
  FROM sage_stock_balances WHERE raw_material_id = p_raw_material_id AND warehouse_id = 18 FOR UPDATE;
  IF v_sage_balance IS NULL THEN RAISE EXCEPTION 'No Sage RM balance is available for this material. Refresh Sage stock and retry.'; END IF;
  IF v_sage_synced_at IS NULL OR v_sage_synced_at < now() - interval '2 minutes' THEN
    RAISE EXCEPTION 'Sage RM stock is not current. Refresh live Sage stock before creating the transfer.';
  END IF;

  SELECT COALESCE(quantity, 0) INTO v_buffer_balance
  FROM warehouse_stock_balances WHERE raw_material_id = p_raw_material_id AND warehouse_id = v_buffer_warehouse_id FOR UPDATE;
  v_available := v_sage_balance - COALESCE(v_buffer_balance, 0);
  IF v_available < p_quantity THEN
    RAISE EXCEPTION 'Insufficient Sage RM stock available for transfer. Available: %, Required: %', GREATEST(v_available, 0), p_quantity;
  END IF;

  LOOP
    v_transfer_number := 'MT-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-' || lpad((floor(random() * 900000) + 100000)::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM material_transfers WHERE transfer_number = v_transfer_number);
    v_attempt := v_attempt + 1;
    IF v_attempt > 10 THEN RAISE EXCEPTION 'Could not generate a unique transfer reference. Please retry.'; END IF;
  END LOOP;

  INSERT INTO material_transfers (
    transfer_number, raw_material_id, from_warehouse_id, buffer_warehouse_id,
    quantity, unit, transfer_date, purpose, notes, production_order_id, status,
    requested_by, buffer_approved_by, buffer_approved_at, transfer_batch_key
  ) VALUES (
    v_transfer_number, p_raw_material_id, p_from_warehouse_id, v_buffer_warehouse_id,
    p_quantity, COALESCE(NULLIF(p_unit, ''), 'kg'), COALESCE(p_transfer_date, CURRENT_DATE),
    v_ist_reference, COALESCE(p_notes, ''), p_production_order_id, 'in_buffer',
    p_requested_by, p_requested_by, now(), p_transfer_batch_key
  ) RETURNING id INTO v_transfer_id;

  INSERT INTO stock_movements (movement_type, reference_type, reference_id, raw_material_id, warehouse_id, quantity, unit, movement_date, performed_by, notes)
  VALUES ('transfer', 'material_transfer', v_transfer_id, p_raw_material_id, v_buffer_warehouse_id, p_quantity,
          COALESCE(NULLIF(p_unit, ''), 'kg'), now(), p_requested_by, 'Step 1: RM to Production Buffer (fresh Sage balance verified)');

  PERFORM reconcile_transferable_rm_balance(p_raw_material_id);
  RETURN v_transfer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_material_transfer_to_buffer(uuid, uuid, numeric, text, date, text, text, uuid, uuid, uuid) TO authenticated, service_role;
