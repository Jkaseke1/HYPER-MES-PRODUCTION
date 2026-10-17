# Managing Director read-only access

Use `profiles.role = 'md'` for the MD account. Do not give the person an admin
profile or service key. No specific account is assigned by this change.

## Behaviour

- All module routes remain visible, including reports, payroll and administration.
- Permission-based actions deny approvals and edits even if secondary roles carry
  an old admin permission. Explicit legacy MD mutation grants are removed.
- A frontend request guard blocks operational writes, mutating RPCs, Edge Function
  calls and file uploads/deletions. Navigation, search, filters and exports remain
  usable. Some older screens may still display edit controls; writes are rejected.
- Authentication/session maintenance and own append-only access audit events are
  allowed. Password/session operations are not business-record modifications.
- The database migration adds MD SELECT policies to existing RLS-enabled public
  tables, MD mutation triggers on existing public tables, a PostgREST request hook
  rejecting mutating/unknown RPCs, and Storage object write restrictions.
- Service-role bridge operations and other users retain their existing checks.
- Admin Edge Functions explicitly reject a primary MD profile, even if it also
  has an admin entry in user_roles. Deploy both updated functions.

## Deployment and verification

1. Restore Supabase access and verify backups/recovery arrangements first.
2. Test migration `20261017180000_make_md_read_only.sql` in a staging copy.
   It is transactional with a five-second lock timeout. It refuses to replace an
   existing PostgREST pre-request hook; compose that hook deliberately if present.
3. Test MD reads across modules and attachments, then verify direct PATCH/DELETE,
   approvals, stock refresh requests, retries, storage writes and admin functions
   return permission errors. Do not use real financial transactions as tests.
4. Verify Admin edits and a service-role read/write fixture still work in staging.
5. Deploy database controls and both Edge Functions, then frontend. Re-login.
6. An administrator assigns the intended existing account to the MD profile role.
   Review and remove conflicting secondary roles for clarity.

This code is not proof that live controls are installed. No migration, Edge
Function deployment, or live account assignment has been performed by the local
tests. New public tables/RPCs need this guard included in their deployment;
unknown RPCs are intentionally denied for MD. Security-definer report RPCs that
check their own role lists may need an explicitly reviewed MD read permission.

No business rows are deleted or backfilled. Audit history is retained. Reads of
configuration should never be used to expose passwords, API keys or service keys.
