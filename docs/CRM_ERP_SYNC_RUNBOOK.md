# HYPERFEEDS CRM ERP population runbook

## What is imported

The bridge reads the Sage `dbo.Client` customer master and populates `crm_customers` with:

- Sage account code and internal customer ID
- customer name, contact, email and telephone
- physical and delivery/postal addresses
- customer group, area/territory and currency
- Sage sales representative code and name
- payment terms, tax number and registration number
- credit limit, account balance and hold/cash/COD/insurance flags

The sync does not overwrite CRM-owned fields such as account owner, health status, lifecycle stage, notes, next action or next-contact date.

## One-time import

On the machine that runs the HYPER MES bridge, after applying the CRM migrations:

```powershell
cd C:\path\to\HYPER-MES\bridge
npm run sync-crm-customers
```

The command is read-only against Sage and writes the resulting customer master into Supabase using the bridge service key.

## Verify in Supabase

```sql
SELECT
  COUNT(*) AS crm_customers,
  COUNT(*) FILTER (WHERE status = 'active') AS active_customers,
  COUNT(*) FILTER (WHERE segment = 'commercial') AS commercial_customers,
  COUNT(*) FILTER (WHERE segment = 'small_scale') AS small_scale_customers,
  COUNT(*) FILTER (WHERE sage_customer_code IS NOT NULL) AS sage_mapped_customers
FROM crm_customers;

SELECT
  sage_customer_code,
  legal_name,
  segment,
  area,
  sage_rep_name,
  credit_limit,
  account_balance,
  on_hold
FROM crm_customers
ORDER BY legal_name
LIMIT 25;
```

## Classification note

The initial segment is inferred from Sage group, area and customer name using configurable patterns. Confirm the commercial versus small-scale classification after the first import; the sales team can then correct it in CRM without losing the Sage mapping.
