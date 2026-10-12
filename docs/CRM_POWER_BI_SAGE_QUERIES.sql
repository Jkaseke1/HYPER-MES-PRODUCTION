/* HYPERFEEDS CRM Power BI source queries
   Run against the Sage company database. These queries use the verified Sage
   objects/columns already identified during the CRM discovery work.

   Recommended Power BI model:
     dim_customer  <- customer_master
     fact_invoice  <- invoice_header
     fact_invoice_line <- invoice_line
     dim_product <- stock item fields in invoice_line

   Credit risk, ownership and open actions come from the HYPER MES CRM tables
   and should be loaded separately from Supabase.
*/

-- 1. Customer master and credit snapshot
SELECT
    c.DCLink AS sage_customer_id,
    LTRIM(RTRIM(c.Account)) AS sage_customer_code,
    NULLIF(LTRIM(RTRIM(c.Name)), '') AS customer_name,
    NULLIF(LTRIM(RTRIM(c.GroupDescription)), '') AS customer_group,
    NULLIF(LTRIM(RTRIM(c.AreaDescription)), '') AS territory,
    NULLIF(LTRIM(RTRIM(c.RepCode)), '') AS sage_rep_code,
    NULLIF(LTRIM(RTRIM(c.RepName)), '') AS sage_rep_name,
    NULLIF(LTRIM(RTRIM(c.CurrencyCode)), '') AS currency_code,
    NULLIF(LTRIM(RTRIM(c.AccountTerms)), '') AS payment_terms,
    c.Credit_Limit AS credit_limit,
    c.DCBalance AS account_balance,
    CAST(c.On_Hold AS bit) AS on_hold,
    CAST(c.CashDebtor AS bit) AS cash_customer,
    CAST(c.bCODAccount AS bit) AS cash_on_delivery_customer,
    CAST(c.bInsuranceCustomer AS bit) AS insurance_customer,
    NULLIF(LTRIM(RTRIM(c.Tax_Number)), '') AS tax_number,
    NULLIF(LTRIM(RTRIM(c.Contact_Person)), '') AS primary_contact,
    NULLIF(LTRIM(RTRIM(c.Telephone)), '') AS telephone,
    NULLIF(LTRIM(RTRIM(c.EMail)), '') AS email,
    NULLIF(LTRIM(RTRIM(CONCAT_WS(', ', c.Physical1, c.Physical2, c.Physical3, c.Physical4, c.Physical5))), '') AS physical_address,
    c.Client_dModifiedDate AS sage_modified_at
FROM dbo.Client c;

-- 2. Invoice header fact. Keep one row per Sage document.
SELECT
    i.AutoIndex AS sage_invoice_id,
    LTRIM(RTRIM(i.InvNumber)) AS invoice_number,
    i.AccountID AS sage_customer_id,
    LTRIM(RTRIM(c.Account)) AS sage_customer_code,
    i.InvDate AS invoice_date,
    i.DueDate AS due_date,
    i.DeliveryDate AS delivery_date,
    LTRIM(RTRIM(i.OrderNum)) AS order_number,
    LTRIM(RTRIM(i.DeliveryNote)) AS delivery_note,
    LTRIM(RTRIM(i.cTaxNumber)) AS tax_number,
    LTRIM(RTRIM(i.cAccountName)) AS invoice_account_name,
    i.DocType AS document_type,
    i.DocState AS document_state,
    i.InvTotExcl AS revenue_excl,
    i.InvTotTax AS tax_amount,
    i.InvTotIncl AS revenue_incl,
    CASE
      WHEN LTRIM(RTRIM(i.InvNumber)) LIKE 'HFCRN%' THEN -ABS(COALESCE(i.InvTotExcl, 0))
      WHEN i.DocType IN (3, 4) THEN -ABS(COALESCE(i.InvTotExcl, 0))
      ELSE COALESCE(i.InvTotExcl, 0)
    END AS net_revenue
FROM dbo.InvNum i
LEFT JOIN dbo.Client c ON c.DCLink = i.AccountID
WHERE i.InvDate IS NOT NULL
  AND ISNULL(i.DocState, 0) NOT IN (4, 5);

-- 3. Invoice lines for feed/chick classification and product analysis.
SELECT
    i.AutoIndex AS sage_invoice_id,
    LTRIM(RTRIM(i.InvNumber)) AS invoice_number,
    i.AccountID AS sage_customer_id,
    LTRIM(RTRIM(c.Account)) AS sage_customer_code,
    i.InvDate AS invoice_date,
    l.idInvoiceLines AS sage_invoice_line_id,
    l.iStockCodeID AS sage_stock_id,
    LTRIM(RTRIM(s.Code)) AS sage_stock_code,
    LTRIM(RTRIM(s.Description_1)) AS product_name,
    l.fQuantity AS quantity,
    l.fUnitPriceExcl AS unit_price_excl,
    l.fQuantityLineTotExcl AS line_revenue_excl,
    l.fQuantityLineTotIncl AS line_revenue_incl,
    CASE
      WHEN LOWER(CONCAT(s.Code, ' ', s.Description_1)) LIKE '%chick%' THEN 'chicks'
      WHEN LOWER(CONCAT(s.Code, ' ', s.Description_1)) LIKE '%feed%' THEN 'feed'
      ELSE 'other'
    END AS provisional_product_category
FROM dbo.InvNum i
JOIN dbo._btblInvoiceLines l ON l.iInvoiceID = i.AutoIndex
LEFT JOIN dbo.StkItem s ON s.StockLink = l.iStockCodeID
LEFT JOIN dbo.Client c ON c.DCLink = i.AccountID
WHERE i.InvDate IS NOT NULL
  AND ISNULL(i.DocState, 0) NOT IN (4, 5);

-- 4. Optional ageing view for credit-risk enrichment.
SELECT
    c.DCLink AS sage_customer_id,
    LTRIM(RTRIM(c.Account)) AS sage_customer_code,
    aging.AccountBalance AS ageing_balance,
    aging.CurrentBalance,
    aging.Balance30,
    aging.Balance60,
    aging.Balance90,
    aging.Balance120
FROM dbo.Client c
LEFT JOIN dbo._avCustomerAging aging ON aging.AccountLink = c.DCLink;
