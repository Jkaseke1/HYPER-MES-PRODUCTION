# Material-transfer creation protection

Existing safeguards remain: active IST creation is serialized by IST number;
duplicate material lines in the same batch are rejected; Buffer reservations
are transactional; a Sage outcome marked unknown cannot be retried normally.
Read-only stock-refresh retries do not create material transfers or Sage postings.

The new create_material_transfer_bundle RPC creates all selected lines inside a
single database transaction using the original per-line stock checks. If any
line fails, its earlier lines and reservations roll back. A bundle key is locked
before saving. An exact retry returns the existing row IDs without allocating
again; a changed payload with the same key is rejected.

The frontend uses one bundle request, keeps the same key for an unchanged retry,
and blocks concurrent clicks synchronously. After a lost response, it does not
claim nothing was saved. It tells the user to check the existing IST.
Keys are retained for the current page session; after reload, a new request key
still cannot bypass the existing database active-IST guard.

Deployment: apply 20261019200000_atomic_material_transfer_creation.sql in a
staging copy and validate rollback, concurrent requests and lost-response replay,
then apply to Production before publishing the frontend. Do not run actual test
stock movements in Production. This migration adds one function; it does not
rewrite historical records or create/post Sage transactions. No bridge or SDK
restart is needed for this change.

Local tests exercise the UI submission/retry flow and SQL structure. The SQL
has not been executed against a local/staging PostgreSQL database here.
This is not a claim of universal exactly-once Sage posting: never replay an
uncertain Sage outcome without reconciling Sage's original transaction rows.
