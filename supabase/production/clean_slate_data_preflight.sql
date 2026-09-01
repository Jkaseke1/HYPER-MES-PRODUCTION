-- PlantControl Production clean-slate data preflight (read-only).
-- Run before importing approved master data or 31 August opening stock.
-- READY means the table is empty as required. INFO rows are intentionally preserved.

WITH counts(category, object_name, expected_mode, row_count) AS (
  SELECT 'identity', 'auth.users', 'PRESERVE', count(*) FROM auth.users
  UNION ALL SELECT 'identity', 'profiles', 'PRESERVE', count(*) FROM public.profiles
  UNION ALL SELECT 'access', 'roles', 'PRESERVE', count(*) FROM public.roles
  UNION ALL SELECT 'access', 'permissions', 'PRESERVE', count(*) FROM public.permissions
  UNION ALL SELECT 'access', 'role_permissions', 'PRESERVE', count(*) FROM public.role_permissions
  UNION ALL SELECT 'access', 'user_roles', 'PRESERVE', count(*) FROM public.user_roles
  UNION ALL SELECT 'access', 'user_branch_access', 'PRESERVE', count(*) FROM public.user_branch_access

  UNION ALL SELECT 'master_data', 'branches', 'EMPTY_BEFORE_MASTER_IMPORT', count(*) FROM public.branches
  UNION ALL SELECT 'master_data', 'warehouses', 'EMPTY_BEFORE_MASTER_IMPORT', count(*) FROM public.warehouses
  UNION ALL SELECT 'master_data', 'suppliers', 'EMPTY_BEFORE_MASTER_IMPORT', count(*) FROM public.suppliers
  UNION ALL SELECT 'master_data', 'raw_materials', 'EMPTY_BEFORE_MASTER_IMPORT', count(*) FROM public.raw_materials
  UNION ALL SELECT 'master_data', 'packaging_skus', 'EMPTY_BEFORE_MASTER_IMPORT', count(*) FROM public.packaging_skus
  UNION ALL SELECT 'master_data', 'chick_branches', 'EMPTY_BEFORE_MASTER_IMPORT', count(*) FROM public.chick_branches
  UNION ALL SELECT 'master_data', 'chick_customers', 'EMPTY_BEFORE_MASTER_IMPORT', count(*) FROM public.chick_customers
  UNION ALL SELECT 'master_data', 'chick_suppliers', 'EMPTY_BEFORE_MASTER_IMPORT', count(*) FROM public.chick_suppliers

  UNION ALL SELECT 'opening_stock', 'sage_stock_balances', 'EMPTY_BEFORE_OPENING_STOCK', count(*) FROM public.sage_stock_balances
  UNION ALL SELECT 'opening_stock', 'warehouse_stock_balances', 'EMPTY_BEFORE_OPENING_STOCK', count(*) FROM public.warehouse_stock_balances
  UNION ALL SELECT 'opening_stock', 'stock_movements', 'EMPTY_BEFORE_OPENING_STOCK', count(*) FROM public.stock_movements
  UNION ALL SELECT 'opening_stock', 'raw_material_lots', 'EMPTY_BEFORE_OPENING_STOCK', count(*) FROM public.raw_material_lots
  UNION ALL SELECT 'opening_stock', 'rm_daily_snapshots', 'EMPTY_BEFORE_OPENING_STOCK', count(*) FROM public.rm_daily_snapshots
  UNION ALL SELECT 'opening_stock', 'packaging_stock', 'EMPTY_BEFORE_OPENING_STOCK', count(*) FROM public.packaging_stock

  UNION ALL SELECT 'operations', 'weigh_bridge_tickets', 'EMPTY_BEFORE_GO_LIVE', count(*) FROM public.weigh_bridge_tickets
  UNION ALL SELECT 'operations', 'goods_received_notes', 'EMPTY_BEFORE_GO_LIVE', count(*) FROM public.goods_received_notes
  UNION ALL SELECT 'operations', 'grn_items', 'EMPTY_BEFORE_GO_LIVE', count(*) FROM public.grn_items
  UNION ALL SELECT 'operations', 'quality_inspections', 'EMPTY_BEFORE_GO_LIVE', count(*) FROM public.quality_inspections
  UNION ALL SELECT 'operations', 'stock_takes', 'EMPTY_BEFORE_GO_LIVE', count(*) FROM public.stock_takes
  UNION ALL SELECT 'operations', 'stock_take_lines', 'EMPTY_BEFORE_GO_LIVE', count(*) FROM public.stock_take_lines
  UNION ALL SELECT 'operations', 'material_transfers', 'EMPTY_BEFORE_GO_LIVE', count(*) FROM public.material_transfers
  UNION ALL SELECT 'operations', 'production_plans', 'EMPTY_BEFORE_GO_LIVE', count(*) FROM public.production_plans
  UNION ALL SELECT 'operations', 'production_orders', 'EMPTY_BEFORE_GO_LIVE', count(*) FROM public.production_orders
  UNION ALL SELECT 'operations', 'production_outputs', 'EMPTY_BEFORE_GO_LIVE', count(*) FROM public.production_outputs
  UNION ALL SELECT 'operations', 'sales_orders', 'EMPTY_BEFORE_GO_LIVE', count(*) FROM public.sales_orders
  UNION ALL SELECT 'operations', 'dispatch_orders', 'EMPTY_BEFORE_GO_LIVE', count(*) FROM public.dispatch_orders
  UNION ALL SELECT 'operations', 'finished_goods_transfers', 'EMPTY_BEFORE_GO_LIVE', count(*) FROM public.finished_goods_transfers
  UNION ALL SELECT 'operations', 'maintenance_work_orders', 'EMPTY_BEFORE_GO_LIVE', count(*) FROM public.maintenance_work_orders
  UNION ALL SELECT 'operations', 'worker_attendance', 'EMPTY_BEFORE_GO_LIVE', count(*) FROM public.worker_attendance
  UNION ALL SELECT 'operations', 'payroll_periods', 'EMPTY_BEFORE_GO_LIVE', count(*) FROM public.payroll_periods
  UNION ALL SELECT 'operations', 'chick_purchase_orders', 'EMPTY_BEFORE_GO_LIVE', count(*) FROM public.chick_purchase_orders
  UNION ALL SELECT 'operations', 'chick_delivery_notes', 'EMPTY_BEFORE_GO_LIVE', count(*) FROM public.chick_delivery_notes
  UNION ALL SELECT 'operations', 'chick_distribution_schedules', 'EMPTY_BEFORE_GO_LIVE', count(*) FROM public.chick_distribution_schedules

  UNION ALL SELECT 'integration', 'sync_log', 'EMPTY_AND_DISABLED', count(*) FROM public.sync_log
  UNION ALL SELECT 'integration', 'plant_integration_sources', 'EMPTY_AND_DISABLED', count(*) FROM public.plant_integration_sources
  UNION ALL SELECT 'integration', 'plant_integration_events', 'EMPTY_AND_DISABLED', count(*) FROM public.plant_integration_events
  UNION ALL SELECT 'integration', 'sage_imported_transactions', 'EMPTY_AND_DISABLED', count(*) FROM public.sage_imported_transactions
  UNION ALL SELECT 'integration', 'chick_payment_alerts', 'EMPTY_AND_DISABLED', count(*) FROM public.chick_payment_alerts
)
SELECT
  category,
  object_name,
  expected_mode,
  row_count,
  CASE
    WHEN expected_mode = 'PRESERVE' THEN 'INFO'
    WHEN row_count = 0 THEN 'READY'
    ELSE 'REVIEW'
  END AS status
FROM counts
ORDER BY
  CASE
    WHEN expected_mode <> 'PRESERVE' AND row_count > 0 THEN 1
    WHEN expected_mode = 'PRESERVE' THEN 3
    ELSE 2
  END,
  category,
  object_name;
