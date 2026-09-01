-- Full PlantControl UI schema inventory (read-only).
-- This query does not change the database. It reports whether every
-- user-facing Supabase relation referenced by the Production frontend exists.

WITH required_objects(object_name) AS (
  VALUES
    ('approval_audit_log'), ('approval_history'), ('batch_packaging_used'), ('batch_sequences'),
    ('branches'), ('chick_branches'), ('chick_customers'), ('chick_deliveries'),
    ('chick_delivery_notes'), ('chick_distribution_lines'), ('chick_distribution_schedules'),
    ('chick_hatch_nights'), ('chick_payment_alerts'), ('chick_po_lines'), ('chick_purchase_orders'),
    ('chick_routes'), ('chick_supplier_consignments'), ('chick_supplier_invoices'), ('chick_suppliers'),
    ('cost_settings'), ('currencies'), ('dispatch_items'), ('dispatch_orders'),
    ('ecocash_payment_batches'), ('finished_goods_transfers'), ('fleet_allocations'),
    ('fleet_breakdowns'), ('fleet_maintenance'), ('fleet_vehicles'), ('formulation_categories'),
    ('formulation_ingredients'), ('formulations'), ('goods_received_notes'), ('grn_attachments'),
    ('grn_items'), ('inventory_depletion_forecasts'), ('labour_rates'), ('machines'),
    ('macropack_bom_ingredients'), ('macropack_bom_packaging'), ('macropack_boms'),
    ('macropack_manufacture_issues'), ('macropack_manufacture_orders'), ('macropack_packaging_issues'),
    ('maintenance_schedules'), ('maintenance_spares'), ('maintenance_transactions'),
    ('maintenance_work_orders'), ('management_report_schedules'), ('material_transfers'),
    ('monthly_operations_trends'), ('monthly_rm_reconciliation'), ('operation_templates'),
    ('packaging_skus'), ('packaging_stock'), ('payroll_lines'), ('payroll_periods'),
    ('pending_approvals'), ('period_production_summary'), ('permissions'),
    ('plant_integration_events'), ('plant_integration_sources'), ('production_bom_packaging'),
    ('production_logs'), ('production_notice_attachments'), ('production_notices'),
    ('production_operations'), ('production_order_downtime'), ('production_order_materials'),
    ('production_orders'), ('production_outputs'), ('production_plan_items'), ('production_plans'),
    ('profiles'), ('quality_inspections'), ('quality_lot_actions'), ('quality_lot_controls'),
    ('raw_materials'), ('recon_finished_goods'), ('recon_macropack_usage'), ('recon_macropacks'),
    ('recon_observations'), ('recon_production'), ('recon_raw_materials'), ('reconciliation_periods'),
    ('rm_cost_register'), ('rm_daily_issues'), ('rm_daily_receipts'), ('rm_daily_snapshots'),
    ('role_permissions'), ('roles'), ('sage_imported_transactions'), ('sage_stock_balances'),
    ('sales_order_items'), ('sales_orders'), ('spare_parts'), ('stock_exceptions'),
    ('stock_movements'), ('stock_take_audit_log'), ('stock_take_lines'), ('stock_takes'),
    ('suppliers'), ('sync_log'), ('temporary_workers'), ('usd_zig_rate_history'),
    ('user_access_logs'), ('user_branch_access'), ('user_roles'), ('variance_reason_codes'),
    ('warehouse_stock_balances'), ('warehouses'), ('weigh_bridge_tickets'), ('worker_attendance'),
    ('v_chick_grv_unprocessed'), ('v_chick_margin'), ('v_chick_reconciliation'),
    ('v_chick_sales_unmatched'), ('v_rm_available_lots'), ('v_sage_stock_for_validation')
)
SELECT
  object_name,
  CASE WHEN to_regclass('public.' || object_name) IS NULL THEN 'MISSING' ELSE 'READY' END AS status
FROM required_objects
ORDER BY status DESC, object_name;
