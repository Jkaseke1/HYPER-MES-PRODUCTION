-- User confirmed PIPGM0001 quantity 200 means 200 empty bags.
-- Sage StockLink 3431 identifies PACKAGING PIG GROWER MEAL 50kg.
-- Sage UOM is unset, not a verified kg stocking unit. No Sage writes here.
-- Keep HFIST11961 on hold in PD while running this one-off correction.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE
  v_material uuid;
  v_transfer uuid;
  v_movement uuid;
  v_count integer;
  v_balances jsonb;
  v_transfers jsonb;
  v_movements jsonb;
  v_material_before jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('HFIST11961', 0));
  PERFORM id FROM public.material_transfers
    WHERE upper(btrim(purpose)) = 'HFIST11961' ORDER BY id FOR UPDATE;
  SELECT count(*) INTO v_count FROM public.material_transfers
    WHERE upper(btrim(purpose)) = 'HFIST11961';
  IF v_count <> 13 OR (SELECT count(DISTINCT transfer_batch_key)
    FROM public.material_transfers WHERE upper(btrim(purpose)) = 'HFIST11961') <> 1 THEN
    RAISE EXCEPTION 'Stopped: expected 13 lines in one HFIST11961 bundle.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.material_transfers
    WHERE upper(btrim(purpose)) = 'HFIST11961' AND (
      status IS DISTINCT FROM 'in_buffer' OR transfer_date IS DISTINCT FROM DATE '2026-10-04'
      OR transfer_batch_key IS NULL OR reversed_at IS NOT NULL OR reversed_by IS NOT NULL
      OR approved_at IS NOT NULL OR production_approved_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'Stopped: date, receipt or reversal state changed. Reconcile before editing.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sync_log s JOIN public.material_transfers t ON t.id = s.reference_id
    WHERE upper(btrim(t.purpose)) = 'HFIST11961' AND s.event_type = 'material_transfer_to_production') THEN
    RAISE EXCEPTION 'Stopped: a Sage posting event exists. Do not change or repost.';
  END IF;
  SELECT id INTO STRICT v_material FROM public.raw_materials
    WHERE upper(btrim(code)) = 'PIPGM0001'
      AND (nullif(btrim(sage_code), '') IS NULL OR upper(btrim(sage_code)) = 'PIPGM0001')
      AND lower(btrim(unit)) IN ('kg', 'units') FOR UPDATE;
  SELECT id INTO STRICT v_transfer FROM public.material_transfers
    WHERE upper(btrim(purpose)) = 'HFIST11961' AND transfer_number = 'MT-20261019-321716'
      AND raw_material_id = v_material AND quantity = 200
      AND lower(btrim(unit)) IN ('kg', 'units');
  IF EXISTS (SELECT 1 FROM public.material_transfers
    WHERE upper(btrim(purpose)) = 'HFIST11961' AND id <> v_transfer
      AND lower(btrim(unit)) IS DISTINCT FROM 'units') OR
    (SELECT sum(quantity) FROM public.material_transfers
      WHERE upper(btrim(purpose)) = 'HFIST11961' AND id <> v_transfer) IS DISTINCT FROM 4525::numeric THEN
    RAISE EXCEPTION 'Stopped: other lines no longer total 4525 units.';
  END IF;
  SELECT id INTO STRICT v_movement FROM public.stock_movements
    WHERE reference_type = 'material_transfer' AND reference_id = v_transfer
      AND raw_material_id = v_material AND movement_type = 'transfer' AND quantity = 200
      AND lower(btrim(unit)) IN ('kg', 'units') FOR UPDATE;
  PERFORM raw_material_id FROM public.warehouse_stock_balances
    WHERE raw_material_id = v_material ORDER BY warehouse_id FOR UPDATE;
  SELECT jsonb_agg(to_jsonb(b) ORDER BY b.warehouse_id) INTO v_balances
    FROM public.warehouse_stock_balances b WHERE raw_material_id = v_material;
  SELECT jsonb_agg(to_jsonb(t) - 'unit' - 'notes' - 'updated_at' ORDER BY t.id) INTO v_transfers
    FROM public.material_transfers t WHERE upper(btrim(t.purpose)) = 'HFIST11961';
  SELECT jsonb_agg(to_jsonb(s) - 'unit' - 'notes' ORDER BY s.id) INTO v_movements
    FROM public.stock_movements s WHERE s.reference_id = v_transfer;
  SELECT to_jsonb(m) - 'unit' - 'name' - 'updated_at' INTO v_material_before
    FROM public.raw_materials m WHERE m.id = v_material;

  UPDATE public.raw_materials SET unit = 'units', name = 'PACKAGING PIG GROWER MEAL 50kg', updated_at = now()
    WHERE id = v_material AND (unit IS DISTINCT FROM 'units' OR name IS DISTINCT FROM 'PACKAGING PIG GROWER MEAL 50kg');
  UPDATE public.material_transfers SET unit = 'units', updated_at = now(),
    notes = concat_ws(E'\n', nullif(notes, ''),
      format('UOM corrected kg -> units before PD receipt: user confirmed 200 empty bags; quantity/date unchanged. Recorded %s by %s.', clock_timestamp(), session_user))
    WHERE id = v_transfer AND unit IS DISTINCT FROM 'units';
  UPDATE public.stock_movements SET unit = 'units',
    notes = concat_ws(E'\n', nullif(notes, ''), 'UOM label corrected kg -> units for HFIST11961; 200 empty bags confirmed; quantity unchanged.')
    WHERE id = v_movement AND unit IS DISTINCT FROM 'units';

  IF v_material_before IS DISTINCT FROM (SELECT to_jsonb(m) - 'unit' - 'name' - 'updated_at'
    FROM public.raw_materials m WHERE m.id = v_material)
    OR v_balances IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.warehouse_id)
    FROM public.warehouse_stock_balances b WHERE raw_material_id = v_material)
    OR v_transfers IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) - 'unit' - 'notes' - 'updated_at' ORDER BY t.id)
      FROM public.material_transfers t WHERE upper(btrim(t.purpose)) = 'HFIST11961')
    OR v_movements IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s) - 'unit' - 'notes' ORDER BY s.id)
      FROM public.stock_movements s WHERE s.reference_id = v_transfer) THEN
    RAISE EXCEPTION 'Stopped: unexpected quantity, balance or document changes; rolling everything back.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.material_transfers
      WHERE upper(btrim(purpose)) = 'HFIST11961' AND unit IS DISTINCT FROM 'units')
    OR NOT EXISTS (SELECT 1 FROM public.raw_materials WHERE id = v_material AND unit = 'units')
    OR NOT EXISTS (SELECT 1 FROM public.stock_movements WHERE id = v_movement AND unit = 'units') THEN
    RAISE EXCEPTION 'Stopped: unit correction incomplete; rolling everything back.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sync_log s JOIN public.material_transfers t ON t.id = s.reference_id
    WHERE upper(btrim(t.purpose)) = 'HFIST11961' AND s.event_type = 'material_transfer_to_production') THEN
    RAISE EXCEPTION 'Stopped: unexpected posting event; rolling everything back.';
  END IF;
END;
$$;
SELECT count(*) AS line_count, sum(t.quantity) AS total_units,
  bool_and(t.unit = 'units') AS all_transfer_units,
  bool_and(m.unit = 'units') AS all_catalogue_units,
  bool_and(t.status = 'in_buffer') AS all_in_buffer,
  min(t.transfer_date) AS earliest_date, max(t.transfer_date) AS latest_date,
  (SELECT count(*) FROM public.sync_log s JOIN public.material_transfers x ON x.id = s.reference_id
    WHERE upper(btrim(x.purpose)) = 'HFIST11961' AND s.event_type = 'material_transfer_to_production') AS posting_events
FROM public.material_transfers t JOIN public.raw_materials m ON m.id = t.raw_material_id
WHERE upper(btrim(t.purpose)) = 'HFIST11961';
COMMIT;
