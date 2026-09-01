-- PlantControl Production Phase 1 schema preflight (read-only).
-- Run in the Production Supabase SQL Editor. It performs no INSERT, UPDATE,
-- DELETE, DDL, Sage call, or bridge activation.

WITH required_tables(table_name) AS (
  VALUES
    ('profiles'), ('roles'), ('permissions'), ('role_permissions'), ('user_roles'), ('user_branch_access'),
    ('branches'), ('warehouses'), ('suppliers'), ('raw_materials'),
    ('goods_received_notes'), ('grn_items'), ('grn_attachments'), ('weigh_bridge_tickets'),
    ('stock_takes'), ('stock_take_lines'), ('stock_take_audit_log'),
    ('material_transfers'), ('warehouse_stock_balances'), ('stock_movements'),
    ('quality_inspections'), ('quality_lot_controls'), ('quality_lot_actions'),
    ('sync_log'), ('batch_sequences'), ('sage_stock_balances')
),
required_columns(table_name, column_name) AS (
  VALUES
    ('goods_received_notes', 'weigh_bridge_ticket_id'),
    ('goods_received_notes', 'sage_grv_number'),
    ('goods_received_notes', 'supplier_invoice'),
    ('weigh_bridge_tickets', 'supplier_id'),
    ('stock_takes', 'title'),
    ('stock_takes', 'person_name'),
    ('stock_takes', 'started_by'),
    ('material_transfers', 'created_by'),
    ('material_transfers', 'buffer_received_at'),
    ('warehouse_stock_balances', 'raw_material_id'),
    ('warehouse_stock_balances', 'warehouse_id'),
    ('warehouse_stock_balances', 'quantity')
),
required_functions(function_name) AS (
  VALUES
    ('approve_grn_and_queue'),
    ('reject_grn'),
    ('record_grn_vat_review'),
    ('reserve_next_sage_grv_sequence'),
    ('request_sync_retry'),
    ('review_stock_take_variance'),
    ('finalize_stock_take')
)
SELECT
  'table' AS check_type,
  table_name AS object_name,
  CASE WHEN to_regclass('public.' || table_name) IS NULL THEN 'MISSING' ELSE 'READY' END AS status
FROM required_tables
UNION ALL
SELECT
  'column' AS check_type,
  table_name || '.' || column_name AS object_name,
  CASE WHEN EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = required_columns.table_name
      AND c.column_name = required_columns.column_name
  ) THEN 'READY' ELSE 'MISSING' END AS status
FROM required_columns
UNION ALL
SELECT
  'function' AS check_type,
  function_name AS object_name,
  CASE WHEN EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = required_functions.function_name
  ) THEN 'READY' ELSE 'MISSING' END AS status
FROM required_functions
ORDER BY check_type, object_name;
