-- Remove the two historical Sage catch-up movements from the Production opening load.
-- Finance confirmed that the physical-count workbook is the authoritative source and
-- Sage had not yet been updated to match it.
--
-- This script is deliberately narrow and aborts unless Production still matches the
-- exact post-import state created by load_raw_material_opening_balances_2026-09-01.sql.

BEGIN;

DO $$
DECLARE
  v_total numeric;
  v_count integer;
  v_maize numeric;
  v_salt numeric;
BEGIN
  SELECT count(*), sum(wsb.quantity)
    INTO v_count, v_total
  FROM public.warehouse_stock_balances wsb
  JOIN public.warehouses w ON w.id = wsb.warehouse_id
  WHERE upper(w.code) = 'RM';

  IF v_count <> 72 OR v_total <> 1067447.45 THEN
    RAISE EXCEPTION 'Correction stopped: expected 72 RM balances / 1067447.45 kg, got % rows / % kg',
      v_count, v_total;
  END IF;

  SELECT
    max(wsb.quantity) FILTER (WHERE upper(rm.code) = 'MAW0001'),
    max(wsb.quantity) FILTER (WHERE upper(rm.code) = 'SAC0001')
  INTO v_maize, v_salt
  FROM public.warehouse_stock_balances wsb
  JOIN public.raw_materials rm ON rm.id = wsb.raw_material_id
  JOIN public.warehouses w ON w.id = wsb.warehouse_id
  WHERE upper(w.code) = 'RM'
    AND upper(rm.code) IN ('MAW0001', 'SAC0001');

  IF v_maize <> 440925 OR v_salt <> 7900 THEN
    RAISE EXCEPTION 'Correction stopped: expected MAW0001=440925 and SAC0001=7900, got % and %',
      v_maize, v_salt;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.stock_movements
  WHERE reference_type = 'sage_rm_catchup_2026_09_01'
    AND (
      notes LIKE '%PostST AutoIdx 2184241%'
      OR notes LIKE '%PostST AutoIdx 2184400%'
    );

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Correction stopped: expected exactly 2 identified Sage catch-up movements, got %', v_count;
  END IF;

  IF (SELECT count(*) FROM public.rm_daily_receipts WHERE grn_reference = 'HFGRV003847') <> 1 THEN
    RAISE EXCEPTION 'Correction stopped: expected exactly one HFGRV003847 daily receipt';
  END IF;

  IF (SELECT count(*) FROM public.rm_daily_issues WHERE production_order_ref = 'HFIST11758') <> 1 THEN
    RAISE EXCEPTION 'Correction stopped: expected exactly one HFIST11758 daily issue';
  END IF;
END
$$;

WITH rm_warehouse AS (
  SELECT id FROM public.warehouses WHERE upper(code) = 'RM' AND is_active
), corrected (material_code, quantity_kg) AS (
  VALUES
    ('MAW0001'::text, 426345::numeric),
    ('SAC0001'::text, 7950::numeric)
)
UPDATE public.warehouse_stock_balances wsb
SET quantity = c.quantity_kg,
    updated_at = now()
FROM corrected c
JOIN public.raw_materials rm ON upper(rm.code) = c.material_code
CROSS JOIN rm_warehouse w
WHERE wsb.raw_material_id = rm.id
  AND wsb.warehouse_id = w.id;

WITH corrected (material_code, quantity_kg) AS (
  VALUES
    ('MAW0001'::text, 426345::numeric),
    ('SAC0001'::text, 7950::numeric)
)
UPDATE public.raw_materials rm
SET current_stock = c.quantity_kg,
    updated_at = now()
FROM corrected c
WHERE upper(rm.code) = c.material_code;

DELETE FROM public.stock_movements
WHERE reference_type = 'sage_rm_catchup_2026_09_01'
  AND (
    notes LIKE '%PostST AutoIdx 2184241%'
    OR notes LIKE '%PostST AutoIdx 2184400%'
  );

DELETE FROM public.rm_daily_receipts
WHERE grn_reference = 'HFGRV003847';

DELETE FROM public.rm_daily_issues
WHERE production_order_ref = 'HFIST11758';

UPDATE public.rm_daily_snapshots snapshot
SET mtd_receipts = 0,
    updated_at = now()
FROM public.raw_materials rm
WHERE snapshot.raw_material_id = rm.id
  AND snapshot.snapshot_date = date '2026-09-01'
  AND upper(rm.code) = 'MAW0001';

UPDATE public.rm_daily_snapshots snapshot
SET issues_to_production = 0,
    updated_at = now()
FROM public.raw_materials rm
WHERE snapshot.raw_material_id = rm.id
  AND snapshot.snapshot_date = date '2026-09-01'
  AND upper(rm.code) = 'SAC0001';

DO $$
DECLARE
  v_balance_rows integer;
  v_total numeric;
  v_master_total numeric;
  v_maize numeric;
  v_salt numeric;
BEGIN
  SELECT count(*), sum(wsb.quantity)
    INTO v_balance_rows, v_total
  FROM public.warehouse_stock_balances wsb
  JOIN public.warehouses w ON w.id = wsb.warehouse_id
  WHERE upper(w.code) = 'RM';

  SELECT sum(current_stock)
    INTO v_master_total
  FROM public.raw_materials;

  SELECT
    max(current_stock) FILTER (WHERE upper(code) = 'MAW0001'),
    max(current_stock) FILTER (WHERE upper(code) = 'SAC0001')
  INTO v_maize, v_salt
  FROM public.raw_materials
  WHERE upper(code) IN ('MAW0001', 'SAC0001');

  IF v_balance_rows <> 72
     OR v_total <> 1052917.45
     OR v_master_total <> 1052917.45
     OR v_maize <> 426345
     OR v_salt <> 7950
     OR EXISTS (SELECT 1 FROM public.stock_movements WHERE reference_type = 'sage_rm_catchup_2026_09_01')
     OR EXISTS (SELECT 1 FROM public.rm_daily_receipts WHERE grn_reference = 'HFGRV003847')
     OR EXISTS (SELECT 1 FROM public.rm_daily_issues WHERE production_order_ref = 'HFIST11758') THEN
    RAISE EXCEPTION 'Correction verification failed: rows=% total=% master=% maize=% salt=%',
      v_balance_rows, v_total, v_master_total, v_maize, v_salt;
  END IF;
END
$$;

COMMIT;

SELECT
  count(*) AS balance_rows,
  round(sum(wsb.quantity), 2) AS current_quantity_kg
FROM public.warehouse_stock_balances wsb
JOIN public.warehouses w ON w.id = wsb.warehouse_id
WHERE upper(w.code) = 'RM';
