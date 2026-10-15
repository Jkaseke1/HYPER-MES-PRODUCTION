# Transfer Queue Hardening

This release removes per-transfer stock-cache reads from the serial Sage posting path. Each RM-to-PD posting is confirmed in sync_log as soon as the SDK returns sagePosting=completed. A deduplicated read-only stock reconciliation is queued separately after the event batch. Stock quantities remain snapshots; check their last-synced timestamp before relying on freshness.

Transfer POST calls have a 120-second deadline. Stock GET calls have a 15-second deadline. A timeout does not prove a Sage posting failed: interrupted, invalid and uncertain responses are marked postingOutcomeUnknown and require verification. Neither the HTTP client nor this worker automatically replays an uncertain transfer. Writes remain serial.

The worker records bridgeStartedAt and sageConfirmedAt in event details, preserving Sage's postedAtUtc when supplied. Queue-created time and these fields separate queue age from SDK confirmation time. The frontend labels local receipt separately, flags unfinished queues after five minutes and identifies uncertain outcomes.

## Deployment

1. Apply supabase/migrations/20261015140000_guard_uncertain_transfer_retries.sql in live Supabase. This guards failed-to-pending transitions for uncertain transfer postings; it does not modify Sage or replay events.
2. Pause new PD receipts briefly and wait until the bridge has no in-flight posting.
3. On the production server, review and run scripts/update-transfer-bridge.ps1 with -SourceCommit set to the released Git commit. It stages and syntax-checks four bridge files, verifies existing worker dependencies, checks for processing events, backs up the files and restarts only the bridge scheduled task. It does not edit .env, replace the whole SDK project or restart the SDK API.
4. If another worker remains running after the task is stopped, the installer refuses to replace files. Do not force-stop an active posting.
5. Inspect the bridge logs, confirm the scheduled task remains running, then receive one authorised new IST. Verify its RM date, Sage recording time, reference and quantities with SELECT queries. Do not replay a historical IST as a test.

If file installation fails before restart, existing files are restored from the backup. After restart has been requested, the installer does not replace files underneath a running worker. A Running task state alone is not proof of a healthy bridge or confirmed Sage posting.

## Limits

These changes address verified implementation bottlenecks and indefinite network waits. They do not establish the cause of the September 46-hour delay, resolve server/network outages or prove that every historical transfer was correct. Never clear an uncertain-outcome marker solely to enable Retry: first reconcile Sage by the original reference, material, warehouses, quantity and audit number.

## Verification

node --test bridge/tests/transferQueue.test.js uses a local mock HTTP server and a VM-backed queue fixture. It verifies bounded requests, no automatic write retry, serial posting, durable confirmation ordering and independence from a stalled stock refresh. No Sage or Supabase connection is used by the tests.
