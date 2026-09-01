-- Adds alert configuration fields to raw_materials and creates trend/forecast views
ALTER TABLE IF EXISTS raw_materials
  ADD COLUMN IF NOT EXISTS alert_threshold_pct numeric NOT NULL DEFAULT 0.1,
  ADD COLUMN IF NOT EXISTS days_of_cover_target numeric NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS alert_channels text[] NOT NULL DEFAULT ARRAY['dashboard'];

CREATE OR REPLACE VIEW inventory_depletion_forecasts AS
WITH consumption AS (
  SELECT
    raw_material_id,
    GREATEST(SUM(quantity), 0) AS qty_used_last_30
  FROM stock_movements
  WHERE movement_type IN ('issue', 'production_input')
    AND movement_date >= NOW() - INTERVAL '30 days'
  GROUP BY raw_material_id
)
SELECT
  rm.id AS raw_material_id,
  rm.name,
  rm.code,
  rm.current_stock,
  COALESCE(consumption.qty_used_last_30 / 30, 0) AS avg_daily_usage,
  CASE
    WHEN COALESCE(consumption.qty_used_last_30, 0) = 0 THEN NULL
    ELSE rm.current_stock / (consumption.qty_used_last_30 / 30)
  END AS days_to_depletion
FROM raw_materials rm
LEFT JOIN consumption ON consumption.raw_material_id = rm.id;

CREATE OR REPLACE VIEW monthly_operations_trends AS
WITH months AS (
  SELECT date_trunc('month', generate_series(
    date_trunc('month', NOW() - INTERVAL '11 months'),
    date_trunc('month', NOW()),
    '1 month'
  )) AS month
),
consumption AS (
  SELECT date_trunc('month', movement_date) AS month,
         SUM(quantity) AS consumption_t
  FROM stock_movements
  WHERE movement_type IN ('issue', 'production_input')
  GROUP BY 1
),
production AS (
  SELECT date_trunc('month', created_at) AS month,
         SUM(actual_qty) AS production_t
  FROM production_orders
  WHERE status = 'completed'
  GROUP BY 1
),
dispatch AS (
  SELECT date_trunc('month', dispatch_date) AS month,
         SUM(total_weight) AS dispatch_t
  FROM dispatch_orders
  GROUP BY 1
)
SELECT
  months.month::date,
  COALESCE(consumption.consumption_t, 0) AS consumption_t,
  COALESCE(production.production_t, 0) AS production_t,
  COALESCE(dispatch.dispatch_t, 0) AS dispatch_t
FROM months
LEFT JOIN consumption ON consumption.month = months.month
LEFT JOIN production ON production.month = months.month
LEFT JOIN dispatch ON dispatch.month = months.month
ORDER BY months.month;
