# Production Schema Completeness Audit

Date: 2026-09-01

## Objective

Prepare a complete PlantControl Production schema without importing UAT
operational data, test data, Sage history, or automatically enabling Sage
bridge side effects.

## Audit Result

The source repository contains 163 historical SQL migrations. The clean
Production repository contains 42 reviewed migrations. The difference is
intentional in part: the source history contains one-off diagnostics, UAT data
seeds, data repairs, and Sage-trigger activation scripts that must not be run
against a new Production database without a controlled cutover.

The Production frontend currently references approximately 100 database
objects. The existing Production baseline covers the core inbound, warehouse,
GRN, weighbridge, stock take, raw materials, initial production, and access
control tables. It does not yet cover every optional application module.

## Current Repairs

The following Production-only repairs have been published and must be applied
in the Production Supabase SQL Editor if not already applied:

1. `20260901113000_repair_production_page_schema.sql`
   - formulation categories
   - production order creator relationship
   - production notices
2. `20260901114000_add_production_nominal_speed.sql`
   - optional formulation production-rate field used by Production Orders

These migrations contain no UAT transactions, stock counts, GRNs, suppliers,
formulations, or Sage data.

## Required Structural Baseline By Module

The following source migrations are schema candidates for a fully functional
frontend. They must be reviewed, made idempotent where necessary, and published
as Production-safe migrations before their associated module is enabled.

| Module | Required source schema candidates | Status |
| --- | --- | --- |
| Maintenance | `20260324000000_create_maintenance_tables.sql`, `20260430_maintenance_spares.sql`, `20260430_maintenance_spares_fix_constraints.sql` | Not in Production baseline |
| Approvals | `20260324100000_create_approval_workflows.sql` | Not in Production baseline |
| Sales and dispatch planning | `20260326000000_create_sales_orders.sql`, `20260326084301_add_sales_and_production_tracking.sql` | Not in Production baseline |
| Production operations | `20260401_add_unit_size_to_production_orders.sql`, `20260410_add_production_order_enhancements.sql`, `20260417_batch_packaging_used.sql`, `20260421_shift_reports_and_downtime.sql`, `20260428_production_orders_updated_at.sql`, `20260722_materials_issued_order_level.sql`, `20260811_add_finished_goods_bag_counts.sql`, `20260814_production_control_centre.sql`, `20260814_add_production_notice_attachments.sql` | Partially covered; review required |
| Formulation and costing | `20260402_add_sage_code_to_formulations.sql`, `20260402_add_unit_size_variants_to_formulations.sql`, `20260420_add_current_stock_to_formulations.sql`, `20260421_labour_and_overhead_rates.sql`, `20260421_labour_rates_per_formulation.sql`, `20260708_price_control.sql` | Partially covered; review required |
| Packaging and macropack | `20260416_phase1_new_tables.sql`, `20260417_batch_packaging_used.sql`, `20260428_packaging_declaration.sql`, `20260428_macropack_cost_per_unit.sql`, `20260806_macropack_issue_upsert_constraint.sql` | Partially covered; review required |
| RM lot and inventory controls | `20260417_negative_stock_prevention.sql`, `20260422_rm_lot_tracking.sql`, `20260422_rm_lot_fifo_deplete.sql`, `20260422_issue_ingredient_lot_decrement.sql` | Not in Production baseline |
| Reconciliation and reporting | `20260416_monthly_rm_reconciliation.sql`, `20260811_create_plant_integration_hub.sql`, `20260812_add_management_reporting_and_sage_imports.sql`, `20260820_daily_operations_and_branch_feed_alerts.sql` | Partially covered; review required |
| Labour and payroll | `20260505_temp_worker_payroll.sql` | Not in Production baseline |
| Chick operations | `20260515_chick_bookings.sql`, `20260515_chick_distribution.sql`, `20260515_process_loss_and_job_cards.sql`, `20260528_add_payment_alerts.sql`, `20260605_chick_reconciliation_layer.sql` | Partially covered; review required |
| Finished-goods transfer | `20260823_finished_goods_transfers_to_dispatch.sql`, `20260824_add_finished_goods_transfer_verification.sql` | Not in Production baseline |

## Explicitly Excluded From the Production Baseline

These files must not be run as part of a clean Production schema deployment:

| Category | Examples | Reason |
| --- | --- | --- |
| UAT or sample data | `20260430_maintenance_spares_seed.sql`, `20260511_seed_rm_daily_data.sql`, `20260518_chick_seed_data.sql` | Would create non-production records |
| Diagnostics and tests | files beginning `CHECK_`, `DISCOVERY_`, `20260409_check_`, `20260409_debug_`, `20260409_test_`, `20260409_verify_` | Inspection or test scripts, not application schema |
| One-time UAT data migrations | `20260625_fix_existing_buffer_balances.sql`, `20260625_migrate_pending_transfers_to_buffer.sql`, `20260825100000_initialize_sage_mfp_production_sequence.sql`, `20260825110000_correct_mfp_sequence_to_sage_10403.sql` | Assumes existing operational records or historical numbering |
| Sage bridge activation and automatic postings | `20260328000002_create_bridge_triggers.sql`, `20260710_sage_posting_bridge_enhancements.sql`, `20260812_material_transfer_sage_bridge.sql`, `20260822_enable_material_transfer_sage_sdk_bridge.sql`, and later Sage-trigger controls | Must wait for signed-off Sage cutover and opening-stock reconciliation |
| Retired Sage review workflow | `20260715_sage_posting_reviews.sql`, `20260722_sage_review_accountant_rls.sql`, `20260818_add_sage_review_reference_fields.sql` | Sage Posting Review has been removed from Production navigation |

## Release Gates

1. Apply every published Production migration and record its successful SQL
   execution in the release log.
2. Build a reviewed, schema-only completeness pack for each module that will be
   enabled at launch. Do not copy historical migrations unchanged.
3. Smoke-test each enabled page with an empty Production database. A page may
   show zero records, but it must not issue 4xx/5xx API requests.
4. Import approved Production master data only: users, roles, branches,
   warehouses, and Sage-mapped materials. Do not import UAT transactions.
5. Reconcile and load the approved 31 August opening balances.
6. Obtain Finance sign-off on the opening balance reconciliation.
7. Only then configure the Production Sage SDK API and bridge in a controlled
   cutover window.

## Next Audit Deliverable

Create a reviewed, idempotent `production-module-baseline` migration pack from
the required structural candidates above. Each migration must state its module,
dependencies, whether it creates any seed/configuration data, and whether it
can contact or queue Sage. No Sage-trigger migration is included by default.
