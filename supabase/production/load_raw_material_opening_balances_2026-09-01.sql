-- PlantControl Production raw-material opening balances.
-- Source: Raw Materials Warehouse Stock Count 30.08.2026.xlsx
-- Source SHA-256: 6B4D550A3D13BD685DE03D1D685C008A4BC7B1F700E2A39A82B9340A012A9373
-- Effective date: 2026-09-01
--
-- Run once in the Production Supabase SQL Editor. The script aborts without
-- changing data if stock activity or opening balances already exist.

BEGIN;

DO $$
BEGIN
  RAISE EXCEPTION 'IMPORT BLOCKED: live Sage contains 19 RM warehouse movements dated 2026-09-01 through 2026-09-03. Reconcile and import those movements before enabling this script.';
END
$$;

CREATE TEMP TABLE opening_rm_stage (
  material_code text PRIMARY KEY,
  quantity_kg numeric(14, 4) NOT NULL CHECK (quantity_kg >= 0),
  source_row integer NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO opening_rm_stage (material_code, quantity_kg, source_row)
VALUES
  ('AMC0001', 1121.1, 9),
  ('BAL0002', 0, 10),
  ('BLY0001', 0, 11),
  ('BAR0002', 0, 12),
  ('BCM0001', 0, 13),
  ('BFP0001', 457.9, 14),
  ('BMP00001', 0, 15),
  ('BPM0001', 0, 16),
  ('BRP0001', 0, 17),
  ('BRP 0001', 1.5, 18),
  ('BGP0001', 0, 19),
  ('BSP0001', 42.5, 20),
  ('CAL0001', 9950, 21),
  ('CAR0001', 713, 22),
  ('CFP0006', 12, 23),
  ('CHL0001', 1098.7, 24),
  ('CON0002', 0, 25),
  ('COC0001', 0, 26),
  ('COS0001', 21685.5, 27),
  ('CSM0001', 0, 28),
  ('CYC0001', 0, 29),
  ('COH0001', 0, 30),
  ('DAI0001', 712, 31),
  ('FGS 001', 242.8, 32),
  ('FFS0001', 37639.93, 33),
  ('GNB0001', 0, 34),
  ('GSTAR001', 0, 35),
  ('HAY0001', 9720, 36),
  ('HCC0001', 0, 37),
  ('3K3', 3425, 38),
  ('LAP0001', 810, 39),
  ('LIF0001', 40063.2, 40),
  ('LAG0001', 36800, 41),
  ('LFS0001', 2853.99, 42),
  ('LUC0001', 0, 43),
  ('LSN0001', 2128.9, 44),
  ('MAO0002', 960, 45),
  ('MAB0001', 0, 46),
  ('MAG0001', 0, 47),
  ('MAW0001', 426345, 48),
  ('MAY0001', 0, 49),
  ('MAG0002', 0, 50),
  ('MAL0001', 0, 51),
  ('MET0001', 1529.2, 52),
  ('MIL0001', 25150, 53),
  ('MOL0001', 2436.67, 54),
  ('MCP0001', 4300, 55),
  ('REC0002', 0, 56),
  ('RECFIN', 0, 57),
  ('RECST', 0, 58),
  ('REF0001', 0, 59),
  ('RIB001', 52228.71, 60),
  ('RCF0001', 7.5, 61),
  ('SAC0001', 7950, 62),
  ('SAS0001', 2566.5, 63),
  ('SOD0001', 371.2, 64),
  ('SOS0001', 209700, 65),
  ('SOR0001', 50779.1, 66),
  ('SOM0001', 0, 67),
  ('SOR0003', 0, 68),
  ('SOB0001', 0, 69),
  ('SUG0001', 14909.4, 70),
  ('SUC0001', 0, 71),
  ('SUNFS', 0, 72),
  ('SUN0001', 21926.91, 73),
  ('SES', 298.8, 74),
  ('SHE0001', 18.4, 75),
  ('THI0001', 25070.29, 76),
  ('URE0001', 435, 77),
  ('WHS0001', 0, 78),
  ('WHB0001', 36456.75, 79),
  ('ZIB0001', 0, 80);

DO $$
DECLARE
  v_count integer;
  v_total numeric;
BEGIN
  SELECT count(*), sum(quantity_kg)
    INTO v_count, v_total
  FROM opening_rm_stage;

  IF v_count <> 72 OR v_total <> 1052917.45 THEN
    RAISE EXCEPTION 'Source control failed: expected 72 rows / 1052917.45 kg, got % rows / % kg',
      v_count, v_total;
  END IF;

  IF (SELECT count(*) FROM public.warehouses WHERE upper(code) = 'RM' AND is_active) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one active RM warehouse';
  END IF;

  SELECT count(*) INTO v_count
  FROM opening_rm_stage s
  LEFT JOIN public.raw_materials rm ON upper(rm.code) = upper(s.material_code)
  WHERE rm.id IS NULL OR NOT rm.is_active OR lower(rm.unit) <> 'kg';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Material control failed: % staged code(s) are missing, inactive, or not measured in kg', v_count;
  END IF;

  IF EXISTS (
    SELECT upper(code)
    FROM public.raw_materials
    GROUP BY upper(code)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Material control failed: duplicate case-insensitive material codes exist';
  END IF;

  IF EXISTS (SELECT 1 FROM public.stock_movements) THEN
    RAISE EXCEPTION 'Opening import stopped: stock movements already exist. Reconcile activity from 1 September first.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.warehouse_stock_balances WHERE quantity <> 0) THEN
    RAISE EXCEPTION 'Opening import stopped: non-zero warehouse balances already exist.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.raw_materials WHERE current_stock <> 0) THEN
    RAISE EXCEPTION 'Opening import stopped: non-zero raw-material current stock already exists.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.rm_daily_snapshots) THEN
    RAISE EXCEPTION 'Opening import stopped: daily raw-material snapshots already exist.';
  END IF;
END
$$;

WITH rm_warehouse AS (
  SELECT id FROM public.warehouses WHERE upper(code) = 'RM' AND is_active
), resolved AS (
  SELECT rm.id AS raw_material_id, s.quantity_kg
  FROM opening_rm_stage s
  JOIN public.raw_materials rm ON upper(rm.code) = upper(s.material_code)
)
INSERT INTO public.warehouse_stock_balances (raw_material_id, warehouse_id, quantity, updated_at)
SELECT r.raw_material_id, w.id, r.quantity_kg, now()
FROM resolved r
CROSS JOIN rm_warehouse w
ON CONFLICT (raw_material_id, warehouse_id)
DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = EXCLUDED.updated_at;

WITH rm_warehouse AS (
  SELECT id FROM public.warehouses WHERE upper(code) = 'RM' AND is_active
)
UPDATE public.raw_materials rm
SET current_stock = s.quantity_kg,
    warehouse_id = w.id,
    updated_at = now()
FROM opening_rm_stage s
CROSS JOIN rm_warehouse w
WHERE upper(rm.code) = upper(s.material_code);

WITH rm_warehouse AS (
  SELECT id FROM public.warehouses WHERE upper(code) = 'RM' AND is_active
)
INSERT INTO public.stock_movements (
  movement_type,
  reference_type,
  raw_material_id,
  warehouse_id,
  quantity,
  unit,
  movement_date,
  notes
)
SELECT
  'adjustment',
  'opening_balance_2026_09_01',
  rm.id,
  w.id,
  s.quantity_kg,
  'kg',
  timestamptz '2026-09-01 00:00:00+02',
  'Opening balance from physical count dated 2026-08-30; source SHA-256 6B4D550A3D13BD685DE03D1D685C008A4BC7B1F700E2A39A82B9340A012A9373; source row ' || s.source_row
FROM opening_rm_stage s
JOIN public.raw_materials rm ON upper(rm.code) = upper(s.material_code)
CROSS JOIN rm_warehouse w
WHERE s.quantity_kg > 0;

INSERT INTO public.rm_daily_snapshots (
  snapshot_date,
  raw_material_name,
  raw_material_id,
  opening_stock,
  opening_stock_base_date,
  physical_stock,
  system_stock,
  comment
)
SELECT
  date '2026-09-01',
  rm.name,
  rm.id,
  s.quantity_kg,
  date '2026-09-01',
  s.quantity_kg,
  s.quantity_kg,
  'Production opening balance from physical count dated 2026-08-30; source row ' || s.source_row
FROM opening_rm_stage s
JOIN public.raw_materials rm ON upper(rm.code) = upper(s.material_code);

DO $$
DECLARE
  v_balance_rows integer;
  v_movement_rows integer;
  v_snapshot_rows integer;
  v_warehouse_total numeric;
  v_master_total numeric;
BEGIN
  SELECT count(*), sum(wsb.quantity)
    INTO v_balance_rows, v_warehouse_total
  FROM public.warehouse_stock_balances wsb
  JOIN public.warehouses w ON w.id = wsb.warehouse_id
  WHERE upper(w.code) = 'RM';

  SELECT sum(rm.current_stock)
    INTO v_master_total
  FROM public.raw_materials rm
  JOIN opening_rm_stage s ON upper(s.material_code) = upper(rm.code);

  SELECT count(*) INTO v_movement_rows
  FROM public.stock_movements
  WHERE reference_type = 'opening_balance_2026_09_01';

  SELECT count(*) INTO v_snapshot_rows
  FROM public.rm_daily_snapshots
  WHERE snapshot_date = date '2026-09-01';

  IF v_balance_rows <> 72
     OR v_warehouse_total <> 1052917.45
     OR v_master_total <> 1052917.45
     OR v_movement_rows <> 39
     OR v_snapshot_rows <> 72 THEN
    RAISE EXCEPTION 'Final verification failed: balances=% total=% master=% movements=% snapshots=%',
      v_balance_rows, v_warehouse_total, v_master_total, v_movement_rows, v_snapshot_rows;
  END IF;
END
$$;

COMMIT;

SELECT
  count(*) AS balance_rows,
  round(sum(wsb.quantity), 2) AS opening_quantity_kg
FROM public.warehouse_stock_balances wsb
JOIN public.warehouses w ON w.id = wsb.warehouse_id
WHERE upper(w.code) = 'RM';
