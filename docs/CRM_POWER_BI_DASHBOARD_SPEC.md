# HYPERFEEDS CRM Power BI dashboard

## Purpose

Give management one operating view of the customer base, customer ownership, growth and risk, product relationship, revenue concentration, open service issues and commercial opportunities.

The dashboard combines:

1. Sage SQL Server: customer master, credit, balances, invoices and invoice lines.
2. HYPER MES Supabase: CRM customer segmentation, ownership, activities, dispatch outcomes and open actions.

Sage remains the financial system of record. HYPER MES remains the system of record for CRM ownership, segmentation and relationship actions.

## Recommended report pages

### 1. Customer base overview

- Active customers: distinct customers with `status = active` and at least one invoice or CRM activity in the selected trailing 12 months.
- Active customers by segment: commercial, small-scale, dealer, institutional and other.
- Active customers by territory: `area` from Sage, with HYPER MES `branch_name` as the operating branch.
- Customer owner and next action table: customer, owner, lifecycle stage, last activity, next due action, Sage balance and risk flag.

### 2. Growth, dormancy and reactivation

- Growing: trailing 90-day invoiced revenue is at least 10% above the preceding 90-day period and has positive sales in the current period.
- Dormant: no invoice in the last 90 days but invoiced revenue in the prior 12 months.
- At risk: on hold, over credit limit, overdue exposure, unresolved complaint, or repeated delivery failure.
- Ready for reactivation: dormant customer with no blocking credit issue and a completed/overdue follow-up action.
- Use a customer detail table beneath the chart so sales staff can act on each customer rather than only see a count.

### 3. Product relationship

- Feed only: feed invoice value in the trailing 12 months and no chick invoice value.
- Chicks only: chick invoice value and no feed invoice value.
- Both: positive values for both products.
- Unknown: invoices exist but product classification is incomplete.

Product classification should be governed by a small mapping table in Power BI (`ProductCategoryMap`) keyed by Sage stock code. Do not rely permanently on product-name keyword matching.

### 4. Revenue concentration and opportunity

- Pareto curve of commercial customers ranked by trailing 12-month revenue.
- Top 5 and top 10 commercial-account revenue share.
- Revenue by segment and territory.
- Opportunities table: dormant high-value accounts, feed-only customers with chick potential, chick-only customers with feed potential, small-scale customers with rising order frequency, and customers whose credit capacity is available but underutilized.

### 5. Service, delivery and credit queue

- Unresolved CRM issues and complaints.
- Dispatches with failed, rejected, late or unconfirmed delivery outcome.
- Customers on hold or above credit limit.
- Open actions overdue by owner.
- Each row must include customer, issue/action, age, owner, severity and next due date.

## Core measures

The Power BI model should use a proper customer dimension and separate invoice and invoice-line facts.

```DAX
Active Customers =
CALCULATE(
    DISTINCTCOUNT(Customer[CustomerKey]),
    Customer[Status] = "active",
    Customer[ActiveInTrailing12M] = TRUE()
)

Revenue TTM =
CALCULATE(
    SUM(Invoice[NetRevenue]),
    DATESINPERIOD('Date'[Date], MAX('Date'[Date]), -12, MONTH)
)

Top 10 Commercial Revenue Share =
DIVIDE(
    CALCULATE([Revenue TTM], TOPN(10, FILTER(ALL(Customer), Customer[Segment] = "commercial"), [Revenue TTM], DESC)),
    CALCULATE([Revenue TTM], Customer[Segment] = "commercial")
)

Growing Customers =
CALCULATE(
    DISTINCTCOUNT(Customer[CustomerKey]),
    Customer[CustomerHealth] = "growing"
)

Open CRM Actions =
CALCULATE(COUNTROWS(Activity), ISBLANK(Activity[CompletedAt]))

Credit Risk Customers =
CALCULATE(
    DISTINCTCOUNT(Customer[CustomerKey]),
    Customer[CreditRisk] = TRUE()
)
```

The actual report should calculate rates from numerators and denominators at customer grain, not average customer-level percentages.

## Refresh and security

- Sage SQL Server: scheduled refresh through an on-premises Power BI gateway.
- Supabase CRM tables: scheduled refresh using the approved database connector or an ETL extract into the reporting database.
- Refresh frequency: daily for management; more frequently only if the gateway and database load support it.
- Row-level security can be added by `area`, `branch_name` or `account_owner` for sales users.
- Financial figures should be restricted to finance and management roles where required.

## Data-quality controls

- Reconcile invoice revenue to Sage's period totals before publishing.
- Monitor Sage-code duplicates, customers without a mapped CRM record, missing areas and unclassified stock codes.
- Exclude cancelled documents and handle credit notes as negative revenue.
- Keep a visible `Data as of` timestamp on the report.
- Mark opportunity classifications as derived indicators, not confirmed sales forecasts.
