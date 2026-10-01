# Transporter Reconciliation Rollout

## Purpose

PlantControl imports a constrained, read-only view of Sage `PostAP` freight
charges and payments for approved transporter supplier accounts. It does not
post, amend, allocate, or pay anything in Sage.

An Admin can mark an approved PlantControl transport claim as paid only when
the imported Sage payment has the same transporter, payment reference, Sage
audit number, and amount. A Sage audit number can be matched to one claim only.

## Release steps

1. Apply `supabase/migrations/20261002100000_add_read_only_sage_transporter_reconciliation.sql` in the PlantControl Supabase SQL editor. This changes PlantControl tables only, never Sage.
2. Deploy the rebuilt Sage SDK API that includes `TransportCostController.cs`.
3. Set these **Machine** environment variables for the Sage SDK scheduled task:

   ```powershell
   [Environment]::SetEnvironmentVariable(
     'HYPER_SAGE_TRANSPORTER_ACCOUNTS',
     'DUMB0001,LUBL0001,LUL0001,PAR0001,SEAR0001',
     'Machine'
   )
   ```

4. Recommended: configure `HYPER_SAGE_REPORTING_SQL_USERNAME` and
   `HYPER_SAGE_REPORTING_SQL_PASSWORD` as a SQL login with only `SELECT` access
   to `dbo.PostAP` and `dbo.Vendor`. Until those exist, the endpoint falls back
   to the current SDK SQL login.
5. In `C:\PlantControl\Production\bridge\.env`, set:

   ```text
   SAGE_TRANSPORT_COST_SYNC_ENABLED=true
   SAGE_TRANSPORT_COST_SYNC_INTERVAL_MS=900000
   SAGE_TRANSPORT_COST_SYNC_LOOKBACK_DAYS=120
   ```

6. Restart `PlantControl Sage SDK API`, then `PlantControl Sage Bridge`.

## Read-only verification

After the first run, use these PlantControl SQL queries:

```sql
select status, entry_count, from_date, to_date, started_at, finished_at, message
from public.inbound_transport_sage_sync_runs
order by started_at desc
limit 10;

select exception_type, severity, supplier_account, reference, audit_number, amount, detail
from public.v_inbound_transport_sage_exceptions
order by severity, transaction_date desc nulls last;
```

Both statements are `SELECT` only.

## Operating boundary

This protects the PlantControl workflow and creates an independently visible
exception queue. It cannot stop a person who has direct Sage posting rights
from recording a payment outside PlantControl. Finance permissions and payment
approval roles in Sage must remain separated from the people approving claims.
