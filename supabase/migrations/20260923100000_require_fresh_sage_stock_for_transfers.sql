-- Material transfers must use a current Sage RM snapshot. Sage is read-only
-- during the preflight refresh; PlantControl only derives its own RM ledger
-- from Sage RM minus stock currently allocated to the internal Buffer.

ALTER TABLE public.sync_log DROP CONSTRAINT IF EXISTS sync_log_event_type_check;
ALTER TABLE public.sync_log
  ADD CONSTRAINT sync_log_event_type_check CHECK (event_type IN (
    'grn_confirmed', 'supplier_return', 'materials_issued', 'production_completed',
    'dispatch_delivered', 'price_sync', 'customer_sync', 'error',
    'material_variance_alert', 'macropack_manufactured',
    'reconciliation_variance_approved', 'rm_cost_updated',
    'reconciliation_completed', 'material_transfer_to_production',
    'finished_goods_transfer_to_dispatch', 'stock_take_sage_snapshot',
    'sage_stock_refresh'
  )) NOT VALID;

CREATE OR REPLACE FUNCTION public.reconcile_transferable_rm_balance(p_raw_material_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rm_warehouse_id uuid;
  v_buffer_warehouse_id uuid;
  v_sage_qty numeric;
  v_buffer_qty numeric;
BEGIN
  SELECT id INTO v_rm_warehouse_id
  FROM warehouses WHERE upper(code) = 'RM' AND is_active LIMIT 1;
  SELECT id INTO v_buffer_warehouse_id
  FROM warehouses WHERE upper(code) = 'BUFFER' AND is_active LIMIT 1;
  IF v_rm_warehouse_id IS NULL OR v_buffer_warehouse_id IS NULL THEN RETURN; END IF;

  SELECT quantity INTO v_sage_qty
  FROM sage_stock_balances
  WHERE raw_material_id = p_raw_material_id AND warehouse_id = 18;
  IF v_sage_qty IS NULL THEN RETURN; END IF;

  SELECT COALESCE(quantity, 0) INTO v_buffer_qty
  FROM warehouse_stock_balances
  WHERE raw_material_id = p_raw_material_id AND warehouse_id = v_buffer_warehouse_id;

  INSERT INTO warehouse_stock_balances (raw_material_id, warehouse_id, quantity, updated_at)
  VALUES (p_raw_material_id, v_rm_warehouse_id, GREATEST(v_sage_qty - COALESCE(v_buffer_qty, 0), 0), now())
  ON CONFLICT (raw_material_id, warehouse_id)
  DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = EXCLUDED.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_rm_balance_after_sage_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.warehouse_id = 18 THEN
    PERFORM reconcile_transferable_rm_balance(NEW.raw_material_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_rm_balance_after_buffer_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  SELECT upper(code) INTO v_code FROM warehouses WHERE id = NEW.warehouse_id;
  IF v_code = 'BUFFER' THEN
    PERFORM reconcile_transferable_rm_balance(NEW.raw_material_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reconcile_rm_after_sage_sync ON public.sage_stock_balances;
CREATE TRIGGER trg_reconcile_rm_after_sage_sync
  AFTER INSERT OR UPDATE OF quantity ON public.sage_stock_balances
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_rm_balance_after_sage_sync();

DROP TRIGGER IF EXISTS trg_reconcile_rm_after_buffer_change ON public.warehouse_stock_balances;
CREATE TRIGGER trg_reconcile_rm_after_buffer_change
  AFTER INSERT OR UPDATE OF quantity ON public.warehouse_stock_balances
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_rm_balance_after_buffer_change();

CREATE OR REPLACE FUNCTION public.request_material_transfer_sage_refresh(p_material_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id uuid;
  v_reference_id uuid := gen_random_uuid();
  v_ids uuid[];
  v_codes text[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'You must be signed in to refresh Sage stock'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'md', 'production_manager', 'supervisor',
                   'warehouse_manager', 'warehouse_clerk', 'raw_material_manager',
                   'rm_manager', 'logistics')
  ) THEN RAISE EXCEPTION 'This role cannot request Sage stock for material transfers'; END IF;
  IF COALESCE(cardinality(p_material_ids), 0) = 0 OR cardinality(p_material_ids) > 20 THEN
    RAISE EXCEPTION 'Select between one and 20 materials to refresh';
  END IF;

  SELECT array_agg(id ORDER BY id), array_agg(upper(coalesce(nullif(sage_code, ''), code)) ORDER BY id)
  INTO v_ids, v_codes
  FROM raw_materials
  WHERE id = ANY(p_material_ids) AND is_active;

  IF COALESCE(cardinality(v_ids), 0) <> cardinality(ARRAY(SELECT DISTINCT unnest(p_material_ids)))
     OR EXISTS (SELECT 1 FROM unnest(v_codes) AS code WHERE code IS NULL OR code = '') THEN
    RAISE EXCEPTION 'Every selected material must be active and have a Sage item code';
  END IF;

  INSERT INTO sync_log (event_type, reference_type, reference_id, status, message, details)
  VALUES (
    'sage_stock_refresh', 'sage_stock', v_reference_id, 'pending',
    'Queued to read live Sage RM stock before material transfer',
    jsonb_build_object('materialIds', v_ids, 'itemCodes', v_codes, 'warehouseCodes', jsonb_build_array('RM'), 'requestedBy', auth.uid())
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_material_transfer_sage_refresh(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_material_transfer_sage_refresh(uuid[]) TO authenticated, service_role;

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
  v_attempt integer := 0;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_requested_by THEN RAISE EXCEPTION 'Authenticated user must request the transfer'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Transfer quantity must be greater than zero'; END IF;
  IF p_transfer_batch_key IS NULL THEN RAISE EXCEPTION 'Transfer batch key is required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid()
      AND role IN ('admin', 'md', 'production_manager', 'supervisor', 'warehouse_manager', 'warehouse_clerk', 'raw_material_manager', 'rm_manager', 'logistics')
  ) THEN RAISE EXCEPTION 'This role cannot create material transfers'; END IF;
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
    COALESCE(p_purpose, ''), COALESCE(p_notes, ''), p_production_order_id, 'in_buffer',
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
