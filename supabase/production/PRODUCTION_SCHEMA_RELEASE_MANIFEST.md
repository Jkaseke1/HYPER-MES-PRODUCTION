# Production schema release manifest

## Purpose

This is the review record for the first PlantControl Production database
release. It creates structure only. It must not copy UAT rows or use a reset,
restore, `DELETE`, or `TRUNCATE` operation.

## Release 1 scope

The initial live operational release is limited to:

- identity, profiles, roles, and audit access controls
- branches, warehouses, suppliers, raw materials, and Sage stock balances
- GRN, weighbridge, finance review, and Sage bridge queue controls
- stock take and the read-only Sage snapshot workflow

Production, dispatch, maintenance, chick, payroll, and other modules remain
disabled until their specific master data and Sage mappings have separately
been approved.

## Explicit exclusions

These files must not be run in Production because they contain UAT identities,
demo data, historical UAT figures, legacy repair work, or a hard-coded Sage
sequence:

- `supabase/seeds/*`
- `supabase/migrations_hold/*`
- `20260401_confirm_jonga_email.sql`
- `20260401000000_auto_confirm_users.sql`
- `20260402_populate_bom_percentages.sql`
- `20260402_populate_bom_percentages_v2.sql`
- `20260430_maintenance_spares_seed.sql`
- `20260511_seed_rm_daily_data.sql`
- `20260518_chick_seed_data.sql`
- `20260625_fix_existing_buffer_balances.sql`
- `20260625_migrate_pending_transfers_to_buffer.sql`
- `20260813_sage_bagged_product_integration_settings.sql`
- `20260825100000_initialize_sage_mfp_production_sequence.sql`
- `20260825110000_correct_mfp_sequence_to_sage_10403.sql`
- `20260826130000_align_mes_grn_sequence_with_sage_grv.sql`
- `CHECK_*` and `DISCOVERY_*` files

The Production GRV and MFP number sequences will be initialized only from a
Finance-approved report from the live Sage company on cutover day.

## Controlled apply gates

Do not run the baseline until all gates are true:

1. PlantControl Production is confirmed empty and is the only selected
   Supabase project.
2. The final SQL release has been reviewed line by line and contains no data
   import or UAT project reference.
3. A Production administrator is named but has not yet been invited.
4. Finance has provided the 31 August closing-stock and next-document-number
   reports from the live Sage company.
5. The Production Sage SDK API and bridge are still disabled.

## After schema application

1. Verify the expected tables, RLS policies, functions, and triggers.
2. Create only the first Production administrator and confirm login.
3. Add the remaining users from the approved access register.
4. Load approved master data and cutover opening stock.
5. Configure a separately guarded Production Sage API and bridge.

No live Sage write is permitted during any schema or user-bootstrap step.
