-- Rebuild Daily Raw Materials System reporting from the controlled RM opening
-- balance and the warehouse stock ledger. This deliberately never replaces a
-- user's physical count or comment.

CREATE OR REPLACE FUNCTION public.refresh_rm_stock_dashboard(
  p_to_date date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
  v_baseline_date constant date := date '2026-09-01';
BEGIN
  IF p_to_date < v_baseline_date THEN
    RAISE EXCEPTION 'Reporting starts on %', v_baseline_date;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'md', 'finance', 'accountant', 'raw_material_manager', 'warehouse_manager')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to refresh raw-material reporting';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.stock_movements sm
    JOIN public.warehouses w ON w.id = sm.warehouse_id
    WHERE upper(w.code) = 'RM'
      AND sm.reference_type = 'opening_balance_2026_09_01'
  ) THEN
    RAISE EXCEPTION 'The 1 September RM opening balance is not available';
  END IF;

  WITH rm_warehouse AS (
    SELECT id
    FROM public.warehouses
    WHERE upper(code) = 'RM' AND is_active
  ),
  baseline_snapshots AS (
    SELECT DISTINCT ON (s.raw_material_id)
      s.raw_material_id,
      s.raw_material_name,
      s.opening_stock
    FROM public.rm_daily_snapshots s
    WHERE s.snapshot_date = v_baseline_date
      AND s.raw_material_id IS NOT NULL
    ORDER BY s.raw_material_id, s.created_at
  ),
  baseline_movements AS (
    SELECT sm.raw_material_id, sum(sm.quantity) AS opening_stock
    FROM public.stock_movements sm
    JOIN rm_warehouse w ON w.id = sm.warehouse_id
    WHERE sm.reference_type = 'opening_balance_2026_09_01'
    GROUP BY sm.raw_material_id
  ),
  materials AS (
    SELECT
      rm.id AS raw_material_id,
      rm.name AS raw_material_name,
      coalesce(bs.opening_stock, bm.opening_stock, 0) AS opening_stock
    FROM public.raw_materials rm
    LEFT JOIN baseline_snapshots bs ON bs.raw_material_id = rm.id
    LEFT JOIN baseline_movements bm ON bm.raw_material_id = rm.id
    WHERE rm.is_active
      AND lower(coalesce(rm.unit, 'kg')) = 'kg'
      AND (
        bs.raw_material_id IS NOT NULL
        OR bm.raw_material_id IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM public.stock_movements sm
          JOIN rm_warehouse w ON w.id = sm.warehouse_id
          WHERE sm.raw_material_id = rm.id
            AND (sm.movement_date AT TIME ZONE 'Africa/Harare')::date >= v_baseline_date
        )
      )
  ),
  report_dates AS (
    SELECT generate_series(v_baseline_date, p_to_date, interval '1 day')::date AS snapshot_date
  ),
  ledger AS (
    SELECT
      sm.raw_material_id,
      (sm.movement_date AT TIME ZONE 'Africa/Harare')::date AS movement_date,
      sm.quantity
    FROM public.stock_movements sm
    JOIN rm_warehouse w ON w.id = sm.warehouse_id
    WHERE sm.reference_type <> 'opening_balance_2026_09_01'
      AND (sm.movement_date AT TIME ZONE 'Africa/Harare')::date >= v_baseline_date
      AND (sm.movement_date AT TIME ZONE 'Africa/Harare')::date <= p_to_date
  ),
  calculated AS (
    SELECT
      d.snapshot_date,
      m.raw_material_id,
      m.raw_material_name,
      coalesce(m.opening_stock, 0)
        + coalesce(sum(l.quantity) FILTER (
          WHERE l.movement_date < date_trunc('month', d.snapshot_date)::date
        ), 0) AS opening_stock,
      coalesce(sum(l.quantity) FILTER (
        WHERE l.movement_date >= date_trunc('month', d.snapshot_date)::date
          AND l.movement_date <= d.snapshot_date
          AND l.quantity > 0
      ), 0) AS mtd_receipts,
      abs(coalesce(sum(l.quantity) FILTER (
        WHERE l.movement_date >= date_trunc('month', d.snapshot_date)::date
          AND l.movement_date <= d.snapshot_date
          AND l.quantity < 0
      ), 0)) AS issues_to_production,
      coalesce(m.opening_stock, 0) + coalesce(sum(l.quantity) FILTER (
        WHERE l.movement_date <= d.snapshot_date
      ), 0) AS system_stock
    FROM report_dates d
    CROSS JOIN materials m
    LEFT JOIN ledger l ON l.raw_material_id = m.raw_material_id
    GROUP BY d.snapshot_date, m.raw_material_id, m.raw_material_name, m.opening_stock
  )
  INSERT INTO public.rm_daily_snapshots (
    snapshot_date,
    raw_material_name,
    raw_material_id,
    opening_stock,
    opening_stock_base_date,
    mtd_receipts,
    issues_to_production,
    physical_stock,
    system_stock
  )
  SELECT
    c.snapshot_date,
    c.raw_material_name,
    c.raw_material_id,
    c.opening_stock,
    CASE
      WHEN date_trunc('month', c.snapshot_date)::date = v_baseline_date THEN date '2026-08-31'
      ELSE (date_trunc('month', c.snapshot_date)::date - 1)
    END,
    c.mtd_receipts,
    c.issues_to_production,
    NULL,
    c.system_stock
  FROM calculated c
  ON CONFLICT (snapshot_date, raw_material_name)
  DO UPDATE SET
    raw_material_id = EXCLUDED.raw_material_id,
    opening_stock = EXCLUDED.opening_stock,
    opening_stock_base_date = EXCLUDED.opening_stock_base_date,
    mtd_receipts = EXCLUDED.mtd_receipts,
    issues_to_production = EXCLUDED.issues_to_production,
    system_stock = EXCLUDED.system_stock,
    updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_rm_stock_dashboard(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_rm_stock_dashboard(date) TO authenticated, service_role;
