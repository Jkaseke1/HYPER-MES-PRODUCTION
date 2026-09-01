# PlantControl Production

This repository is a clean Production release source for PlantControl.

It intentionally excludes UAT history, build artifacts, seed data, temporary
files, staff access registers, local environment files, and Sage credentials.

## Production safety

- Configure the frontend only through GitHub repository secrets.
- Configure the bridge only through a local `bridge/.env` on the Production
  application server.
- Do not copy UAT user identities, records, or Sage references into Production.
- Apply only the reviewed scripts under `supabase/production` and the selected
  schema migrations documented there.
- Keep `BRIDGE_ALLOWED_EVENT_TYPES=stock_take_sage_snapshot` until Finance
  formally releases the GRN workflow.
