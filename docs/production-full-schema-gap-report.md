# Production Full UI Schema Gap Report

Date: 2026-09-01

## Result

The full Production UI inventory confirms that the approved Phase 1 launch
scope is complete. All Phase 1 relations, fields, and functions are present.

The wider frontend references additional optional-module relations that are not
yet part of the clean Production schema. These are not UAT data failures; they
are modules whose later schema migrations were intentionally withheld from the
first Production release pending review.

## Missing Objects By Module

| Module pack | Missing relation examples | Production handling |
| --- | --- | --- |
| Approvals and exceptions | `approval_audit_log`, `approval_history`, `pending_approvals`, `stock_exceptions` | Build schema-only pack |
| Costing and packaging | `cost_settings`, `labour_rates`, `packaging_skus`, `packaging_stock`, `production_bom_packaging`, `macropack_bom_packaging`, `macropack_packaging_issues`, `period_production_summary`, `variance_reason_codes` | Build schema-only pack; no historic costs or configuration seeds |
| Production enhancements | `batch_packaging_used`, `production_notice_attachments`, `production_operations`, `production_order_downtime`, `operation_templates` | Build schema-only pack |
| Dispatch and sales | `sales_orders`, `sales_order_items`, `finished_goods_transfers` | Build schema-only pack; Sage posting remains disabled |
| Maintenance and fleet | maintenance tables, spare parts, fleet tables | Build schema-only pack; no spares/fleet seed data |
| Labour and payroll | `temporary_workers`, `worker_attendance`, `payroll_periods`, `payroll_lines`, `ecocash_payment_batches` | Build schema-only pack; no employee/payroll records |
| Chick operations | chick branches, customers, deliveries, routes, distribution, payment alerts, reporting views | Build schema-only pack; no supplier/customer/chick seeds |
| Reporting and integration | `monthly_rm_reconciliation`, management schedules, integration events/sources, imported Sage transactions, reporting views | Build schemas/views only; no import or bridge activation |

## Mandatory Exclusions

The full baseline must continue to exclude:

- all UAT/demo/data seed migrations
- all diagnostic, test, discovery, and verification scripts
- all one-time historical repair migrations
- all hard-coded document number initialization
- all automatic Sage bridge, trigger, or posting activation

## Completion Standard

Production is fully UI-schema complete only when:

1. The full inventory reports `READY` for every listed relation.
2. Each page opens with no fresh Supabase `400`, `404`, or `500` response.
3. Each module has been smoke-tested with no operational Production data.
4. Sage remains disabled until the separately approved cutover sequence.
