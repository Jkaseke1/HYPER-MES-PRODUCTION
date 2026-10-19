# Transfer stock preflight

The reported error is raised after a refresh log reports success, when the
browser considers a selected cache row older than two minutes. The screenshot
alone does not distinguish a skipped material, server/laptop clock skew or a
long-running refresh. Check the corresponding sync_log stock refresh details
and bridge log to confirm which occurred.

Changes:
- Explicit RM-only checks include active raw materials that also have an active
  formulation, such as FFS0001. Rolling/mixed/PD refresh exclusions are unchanged;
  finished-good PD cache rows retain their formulation ownership.
- Target item codes in the database instead of searching only the first API
  page of the material catalogue.
- Never mark the refresh successful unless every requested code was refreshed.
- Reject missing/non-numeric SDK quantities instead of turning them into zero.
- Timestamp incoming raw-stock cache writes with database time (service role).
- Validate the same two-minute freshness window with database time, not laptop time.
- Show queued/reading/validating progress. Wait up to two minutes and retain
  the same read-only request ID after a timeout rather than enqueue another.

No stock-sufficiency, Buffer reservation, duplicate IST or Sage posting guards
are removed. No financial postings are retried by this change. A disconnected
bridge or unverifiable balance still blocks creation; availability is not guaranteed.

Deployment order:
1. Test and apply 20261019190000_use_database_clock_for_transfer_stock.sql.
   It changes no historical balances or transfer rows.
2. Update bridgeWorker.js and sageStockSync.js using the established backed-up
   server installer in an idle maintenance window. SDK API need not restart.
3. Deploy the frontend, then verify a read-only stock refresh for all selected
   materials. Test normal creation only with an authorised operational transfer.

The migration and live-server update have not been applied by this local change.
