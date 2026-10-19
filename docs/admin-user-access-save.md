# Administrator user edits

The previous browser save updated the profile, swallowed profile errors, deleted
all role/branch assignments and reinserted them without checking results.
Saving one's own admin account could remove the role that authorizes the next
insert. A duplicate Sage agent name could fail profile saving yet still proceed
with destructive assignment changes.

The new admin_save_user_access RPC saves all fields and access assignments in
one transaction. It inserts missing roles before pruning deselected roles,
retains the primary role, rejects self/last-admin removal and records an audit
event. Unique-agent-name and other failures roll the transaction back. The UI
keeps the form open and reports errors instead of implying success.

The list shows the primary profile role even if no junction row exists. Opening
and saving a primary Admin profile includes its active Administrator role row.
Failed role/branch reads prevent the UI from treating unknown data as empty.

Deploy the migration 20261019210000_atomic_admin_user_access_save.sql before
the frontend. Do not re-run the old editor against a live administrator account
while investigating. The migration does not automatically repair accounts or
change any existing role grants. Test failure rollback and self-lockout on a
staging copy first. Local tests mock the UI request; SQL was not executed here.

This does not update Sage Agent records or Sage passwords. A profile email edit
continues to affect only the profile, not the Supabase Auth login email.
