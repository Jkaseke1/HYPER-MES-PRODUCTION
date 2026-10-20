# GRV Correction Deployment

This change is prepared locally. No live data or Sage posting is performed by the migration.

## Deployment Order

1. Review and apply `supabase/migrations/20261020120000_atomic_grn_corrections.sql` to Supabase. This is a schema-changing migration, NOT a read-only diagnostic.
2. Deploy the frontend containing the updated `GoodsReceivedPage.tsx`. The new editor requires the migration; do not deploy it first.
3. Sign in as Raw Materials Manager and reopen an unapproved GRV. Verify the complete lines load, enter the real supplier-document costs, and review the calculated total before saving.
4. A correction returns the receipt to `pending_costing`. Complete costing and submit for Finance review separately. Saving never approves or queues a Sage receipt.

## Scope

- Editable supplier/manual reference/date, supplier invoice/delivery note/order and external reference, receipt notes, linked weighbridge, materials, ordered/received quantities, costs, batches and expiry dates. Lines can be added or removed; quantities and unit costs have no automatic kg/unit conversion.
- Receipt identity, warehouse and original initiator are preserved. Approved, progressed or Sage-queued receipts cannot use this editor.
- All header, line, total, ticket and audit changes commit together. Stale header/line snapshots are rejected. Missing/failed line reads cannot be saved.
- A GRV with linked transport claims cannot change its ticket here. Use the existing transport-evidence workflow; this editor does not rewrite claims or transporter approvals.
- Zero-cost drafts can be saved; Finance submission requires positive unit costs on every line.
- Audit history is recorded in `grn_correction_audit`, restricted to authorised manager/Finance roles.

## Verification

`scripts/test-grn-correction.cjs` uses PGlite in isolation, not a live connection. Install that test dependency into a temporary folder and set `PGLITE_MODULE` to its module directory if it is not installed normally. It checks RM-role access, costs, totals, audit, replacement lines, stale snapshots, approved/queued locks, invalid/empty payloads, rollback and costing submission.

Production build passes. Repository-wide TypeScript checks currently fail on pre-existing errors, including unused imports, missing UI dependencies and nullable transport-detail references. Do not treat a successful bundle as a clean repository-wide typecheck.
