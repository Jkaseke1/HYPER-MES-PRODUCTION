# LIVE GRV Editor and Flat Transport

Target: `nxlhgpqtmgixhazihapz.supabase.co`, confirmed by the operator.
Never apply this release to UAT `appyuqxetlphuxfybmus`.

## Database Deployment

Run the complete `docs/sql/apply-live-grv-editor-flat-transport.sql` file in the
LIVE Supabase SQL Editor. It combines the existing correction function and both
follow-ups in one transaction. Do not run a partial text selection. No RLS needs
to be disabled, and this script does not insert receipt lines, approve anything,
move stock, or queue Sage postings. An error rolls back the whole script.

Pushing GitHub Pages deploys the frontend only; it does not apply this SQL.

If the original bundle was already applied before the receiving-manager permission
repair, run `supabase/migrations/20261021150000_rm_transport_cost_guard_permissions.sql`
in LIVE. Older databases can still have an Admin-only claim trigger even though
the flat-cost RPC permits Raw Materials Manager. This follow-up repairs that
trigger and read policies without changing receipt data or approval permissions.
For the failed HFGRV10421 attempt, first run the read-only
`docs/sql/check-HFGRV10421-after-transport-error.sql` and reopen any existing draft;
do not create another receipt to retry its transport charge.

Read-only verification after applying:

```sql
SELECT to_regprocedure('public.get_grn_correction(uuid)') AS editor,
  to_regprocedure('public.save_grn_correction(uuid,timestamp with time zone,jsonb,jsonb,jsonb)') AS save,
  to_regprocedure('public.save_inbound_transport_flat_claim(uuid,uuid,uuid,numeric,text,text,text,text)') AS transport;
SELECT column_name, column_default FROM information_schema.columns
WHERE table_schema='public' AND table_name='inbound_transport_claims' AND column_name='pricing_basis';
```

## Operator Check

1. Refresh the LIVE app after SQL succeeds and Pages deployment finishes.
2. As Raw Materials Manager or Admin, open an unapproved GRV and choose Edit GRV.
3. Correct existing lines, unit costs, quantities, supplier, documents or dates.
   A genuinely empty draft shows Add line: use the original receipt documents;
   do not infer missing quantities or costs. Save retains the original initiator,
   records an audit entry, and returns the GRV to pending costing.
4. In the GRV details, Inbound Transport Accountability allows the same two roles
   to save a total transport amount, currency, invoice, waybill and notes for a
   company-hired delivery. This amount is for the whole delivery, not per tonne.
5. Complete costing and use the existing Finance approval workflow separately.

Approved/Sage-queued GRVs and submitted/approved/paid freight remain locked.
Historical rate-based claims are not converted automatically. Their existing
total is displayed; deliberately editing an eligible draft saves that total as
flat pricing. Transport charges remain separate from material unit costs.

## Verification

`node scripts/test-grn-correction.cjs` uses isolated PGlite, not Supabase or Sage.
Tests cover roles, totals, audit, empty drafts, hidden/stale lines, rollback,
flat freight independent of mass, legacy preservation, and approval/queue locks.
`npm run build` passes. Repository-wide typecheck has pre-existing errors.
