# Production database baseline

This directory is for reviewed, production-only database release material.

## Safety rules

- Never copy UAT transactional data, user accounts, password hashes, or UUIDs.
- Never run files from `supabase/migrations_hold` or `supabase/seeds` in Production.
- Do not run historical demo, seed, check, discovery, or data-repair scripts as
  part of the Production schema baseline.
- Apply the reviewed baseline only to the empty PlantControl Production project.

## User access input

`docs/templates/production-user-access-template.csv` is the approved source
for the initial Production user invitations after the schema bootstrap.

- `branch_codes=ALL` grants organisation-wide branch scope.
- `branch_codes=NONE` creates no explicit branch assignment. The current
  access register's `no` entries are interpreted the same way during the
  controlled bootstrap and will be normalized then.
- `access_level` must be `read`, `write`, or `admin` when a branch assignment
  is created. It is retained for `NONE` rows for a consistent import format.

Creating the database schema does not create a user or send an invitation.
