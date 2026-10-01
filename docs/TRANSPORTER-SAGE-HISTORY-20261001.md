# Verified transporter history

## Activate

1. Apply `supabase/migrations/20261001220000_seed_verified_transporter_sage_history.sql` in the PlantControl Supabase SQL editor, not Sage SSMS.
2. Deploy the updated frontend, then open Inventory > Inbound Transport Costs as Admin.
3. Review the five transporter accounts and their Sage supplier codes. Confirm local claim currency, payment terms and contact/legal details before creating new hired-transport claims.
4. Use Sage transport history to filter the September entries by transporter. Review repeated references against invoice/payment evidence.

## Scope and safeguards

- Source: user-supplied SSMS extract, Hyperfeeds 2024, PostAP, September 2026, captured 2026-10-01 21:23:45 +02:00.
- Five supplier identities and 26 historical entries. Charges total 8,960.00; payments total 4,980.00; extracted open amounts total 8,115.50. Sage currency ID 0 is retained without assuming USD.
- Open amounts are current at extraction on these entries, not complete account balances or September month-end balances. Payments may settle older charges.
- Matching existing transporters preserves their IDs, local details, activity status, claims and rate cards. Ambiguous or conflicting identity matches abort the transaction for manual review.
- Reapplying the migration does not duplicate the verified entries. Identity is company, supplier account, audit number and transaction type for this supplied extract.
- Historical entries are Admin-readable only; authenticated clients cannot insert, edit or delete them. Existing transporter selection permissions at weighbridge remain unchanged.
- This import does not create live transport claims, mark claims paid, generate bridge events, post to Sage, or change warehouse balances.
- History is a static extract, not an automatic Sage feed. The refresh button rereads PlantControl's imported history.

## Verification

The frontend production build passed. Isolated Playwright checks using mocked source responses passed for entry count, totals, transporter filters, repeated-reference flags, refresh, empty/error states, desktop/mobile rendering and no page runtime errors. The migration has not been applied to a live database or executed against a local PostgreSQL instance. Project-wide TypeScript checking has unrelated pre-existing errors.
