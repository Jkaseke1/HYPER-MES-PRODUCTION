-- PlantControl Production full UI contract preflight (read-only).
-- Checks critical columns, callable functions, RLS, and cutover safety controls.
-- This query performs no INSERT, UPDATE, DELETE, DDL, Sage call, or bridge activation.

WITH required_columns(table_name, column_name) AS (
  VALUES
    ('goods_received_notes', 'weigh_bridge_ticket_id'),
    ('branches', 'sage_code'),
    ('branches', 'sage_warehouse_code'),
    ('branches', 'sage_warehouse_id'),
    ('warehouses', 'sage_warehouse_code'),
    ('warehouses', 'sage_warehouse_id'),
    ('suppliers', 'sage_code'),
    ('raw_materials', 'currency_code'),
    ('raw_materials', 'cost_per_unit_usd'),
    ('raw_materials', 'production_reorder_level'),
    ('goods_received_notes', 'supplier_invoice_no'),
    ('goods_received_notes', 'supplier_delivery_note_no'),
    ('goods_received_notes', 'supplier_order_no'),
    ('goods_received_notes', 'external_reference'),
    ('material_transfers', 'requested_by'),
    ('material_transfers', 'buffer_warehouse_id'),
    ('stock_takes', 'title'),
    ('stock_takes', 'person_name'),
    ('stock_takes', 'started_by'),
    ('warehouse_stock_balances', 'raw_material_id'),
    ('warehouse_stock_balances', 'warehouse_id'),
    ('warehouse_stock_balances', 'quantity'),
    ('production_orders', 'planned_bags'),
    ('production_orders', 'actual_bags'),
    ('production_orders', 'rejected_bags'),
    ('production_orders', 'wastage_bags'),
    ('production_orders', 'unit_size'),
    ('production_orders', 'shift'),
    ('production_orders', 'operators'),
    ('production_orders', 'actual_hours'),
    ('production_orders', 'average_throughput'),
    ('production_orders', 'production_line_cost'),
    ('production_orders', 'labour_force'),
    ('production_orders', 'yield_percentage'),
    ('production_orders', 'process_loss_percentage'),
    ('production_orders', 'process_loss_qty'),
    ('chick_branches', 'branch_name'),
    ('chick_deliveries', 'delivery_number'),
    ('chick_deliveries', 'qty_received'),
    ('chick_deliveries', 'qty_rejected'),
    ('chick_distribution_schedules', 'week_ending'),
    ('chick_distribution_schedules', 'status'),
    ('chick_distribution_lines', 'schedule_id'),
    ('chick_distribution_lines', 'customer_id'),
    ('chick_distribution_lines', 'planned_qty'),
    ('chick_payment_alerts', 'invoice_id'),
    ('chick_payment_alerts', 'channel'),
    ('chick_payment_alerts', 'status'),
    ('chick_delivery_notes', 'sage_grv_number'),
    ('chick_delivery_notes', 'sage_dn_number'),
    ('chick_delivery_notes', 'sage_grv_status'),
    ('chick_delivery_notes', 'sage_grv_value_usd'),
    ('chick_delivery_notes', 'reconciled_at'),
    ('sales_orders', 'order_number'),
    ('sales_order_items', 'sales_order_id'),
    ('finished_goods_transfers', 'status'),
    ('temporary_workers', 'full_name'),
    ('worker_attendance', 'worker_id'),
    ('payroll_periods', 'status'),
    ('payroll_lines', 'payroll_period_id'),
    ('fleet_vehicles', 'registration_number'),
    ('fleet_allocations', 'vehicle_id'),
    ('maintenance_work_orders', 'status'),
    ('rm_cost_register', 'effective_date'),
    ('usd_zig_rate_history', 'effective_date'),
    ('plant_integration_sources', 'enabled'),
    ('plant_integration_events', 'processing_status')
),
required_functions(function_name) AS (
  VALUES
    ('approve_grn_and_queue'),
    ('reject_grn'),
    ('record_grn_vat_review'),
    ('reserve_next_sage_grv_sequence'),
    ('request_sync_retry'),
    ('review_stock_take_variance'),
    ('finalize_stock_take'),
    ('fn_resolve_sage_dn')
),
rls_tables(table_name) AS (
  VALUES
    ('goods_received_notes'), ('grn_items'), ('weigh_bridge_tickets'),
    ('stock_takes'), ('stock_take_lines'), ('material_transfers'),
    ('warehouse_stock_balances'), ('production_orders'),
    ('sales_orders'), ('sales_order_items'), ('finished_goods_transfers'),
    ('temporary_workers'), ('worker_attendance'), ('payroll_periods'), ('payroll_lines'),
    ('fleet_vehicles'), ('fleet_allocations'), ('maintenance_work_orders'),
    ('chick_branches'), ('chick_deliveries'), ('chick_routes'), ('chick_customers'),
    ('chick_distribution_schedules'), ('chick_distribution_lines'),
    ('chick_payment_alerts'), ('chick_dn_map'), ('chick_sage_sales'),
    ('plant_integration_sources'), ('plant_integration_events')
),
checks AS (
  SELECT
    'column'::text AS check_type,
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
    'function',
    function_name,
    CASE WHEN EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = required_functions.function_name
    ) THEN 'READY' ELSE 'MISSING' END
  FROM required_functions

  UNION ALL

  SELECT
    'rls',
    table_name,
    CASE WHEN COALESCE(c.relrowsecurity, false) THEN 'READY' ELSE 'DISABLED' END
  FROM rls_tables
  LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || rls_tables.table_name)

  UNION ALL

  SELECT
    'safety',
    'automatic_chick_payment_trigger',
    CASE WHEN EXISTS (
      SELECT 1
      FROM pg_trigger t
      WHERE t.tgrelid = to_regclass('public.chick_payment_alerts')
        AND NOT t.tgisinternal
    ) THEN 'REVIEW' ELSE 'SAFE' END

  UNION ALL

  SELECT
    'safety',
    'active_plant_integration_sources',
    CASE WHEN EXISTS (
      SELECT 1 FROM public.plant_integration_sources WHERE enabled
    ) THEN 'REVIEW' ELSE 'SAFE' END
)
SELECT check_type, object_name, status
FROM checks
ORDER BY
  CASE status
    WHEN 'MISSING' THEN 1
    WHEN 'REVIEW' THEN 2
    WHEN 'DISABLED' THEN 3
    ELSE 4
  END,
  check_type,
  object_name;
