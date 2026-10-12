// Pull Sage Pastel customer master data into the HYPERFEEDS CRM.
// Sage is authoritative for account/contact/credit fields. CRM-owned fields
// such as segment, owner, health, notes and next action are not overwritten.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', 'sage-sdk-api', '.env') });

const sql = require('mssql');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error('Missing SUPABASE_URL and SUPABASE_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY');

const sageConfig = {
  server: process.env.SAGE_SERVER || process.env.HYPER_SAGE_SERVER || 'localhost',
  port: Number(process.env.SAGE_PORT || 50119),
  database: process.env.SAGE_DATABASE || process.env.HYPER_SAGE_COMPANY_DATABASE,
  user: process.env.SAGE_USER || process.env.HYPER_SAGE_SQL_USERNAME,
  password: process.env.SAGE_PASSWORD || process.env.HYPER_SAGE_SQL_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
};
if (!sageConfig.database || !sageConfig.user || sageConfig.password == null) throw new Error('Missing Sage connection settings');

const supabase = createClient(supabaseUrl, supabaseKey);
const clean = (value) => String(value ?? '').trim();
const bool = (value) => Boolean(value);
const joined = (...values) => values.map(clean).filter(Boolean).join(', ');

function classifySegment(row) {
  const source = [row.GroupDescription, row.AreaDescription, row.Name].map(clean).join(' ').toLowerCase();
  const smallScalePattern = new RegExp(process.env.SAGE_CRM_SMALL_SCALE_PATTERN || 'small[- ]?scale|farmer|grower');
  const dealerPattern = new RegExp(process.env.SAGE_CRM_DEALER_PATTERN || 'dealer|agent|distributor');
  if (smallScalePattern.test(source)) return 'small_scale';
  if (dealerPattern.test(source)) return 'dealer';
  return 'commercial';
}

async function syncCrmCustomersFromSage() {
  const pool = await new sql.ConnectionPool(sageConfig).connect();
  try {
    const result = await pool.request().query(`
      SELECT
        c.DCLink,
        LTRIM(RTRIM(c.Account)) AS Account,
        LTRIM(RTRIM(c.Name)) AS Name,
        LTRIM(RTRIM(c.Contact_Person)) AS Contact_Person,
        LTRIM(RTRIM(c.EMail)) AS EMail,
        LTRIM(RTRIM(c.Telephone)) AS Telephone,
        LTRIM(RTRIM(c.Physical1)) AS Physical1,
        LTRIM(RTRIM(c.Physical2)) AS Physical2,
        LTRIM(RTRIM(c.Physical3)) AS Physical3,
        LTRIM(RTRIM(c.Physical4)) AS Physical4,
        LTRIM(RTRIM(c.Physical5)) AS Physical5,
        LTRIM(RTRIM(c.Post1)) AS Post1,
        LTRIM(RTRIM(c.Post2)) AS Post2,
        LTRIM(RTRIM(c.Post3)) AS Post3,
        LTRIM(RTRIM(c.Post4)) AS Post4,
        LTRIM(RTRIM(c.Post5)) AS Post5,
        LTRIM(RTRIM(c.GroupDescription)) AS GroupDescription,
        LTRIM(RTRIM(c.AreaDescription)) AS AreaDescription,
        LTRIM(RTRIM(c.CurrencyCode)) AS CurrencyCode,
        LTRIM(RTRIM(c.AccountTerms)) AS AccountTerms,
        LTRIM(RTRIM(c.Tax_Number)) AS Tax_Number,
        LTRIM(RTRIM(c.Registration)) AS Registration,
        LTRIM(RTRIM(c.RepCode)) AS RepCode,
        LTRIM(RTRIM(c.RepName)) AS RepName,
        c.Credit_Limit,
        c.DCBalance,
        COALESCE(c.On_Hold, 0) AS On_Hold,
        COALESCE(c.CashDebtor, 0) AS CashDebtor,
        COALESCE(c.bCODAccount, 0) AS bCODAccount,
        COALESCE(c.bInsuranceCustomer, 0) AS bInsuranceCustomer,
        c.Client_dModifiedDate
      FROM dbo.Client c
      WHERE c.DCLink IS NOT NULL
        AND LTRIM(RTRIM(c.Account)) <> ''
      ORDER BY c.Account
    `);

    const now = new Date().toISOString();
    const rows = result.recordset.map((row) => ({
      sage_customer_id: row.DCLink,
      sage_customer_code: clean(row.Account),
      legal_name: clean(row.Name) || clean(row.Account),
      customer_type: 'customer',
      segment: classifySegment(row),
      status: bool(row.On_Hold) ? 'blocked' : 'active',
      customer_group: clean(row.GroupDescription) || null,
      area: clean(row.AreaDescription) || null,
      sage_rep_code: clean(row.RepCode) || null,
      sage_rep_name: clean(row.RepName) || null,
      currency_code: clean(row.CurrencyCode) || null,
      payment_terms: clean(row.AccountTerms) || null,
      credit_limit: row.Credit_Limit ?? null,
      account_balance: row.DCBalance ?? null,
      on_hold: bool(row.On_Hold),
      cash_customer: bool(row.CashDebtor),
      cash_on_delivery_customer: bool(row.bCODAccount),
      insurance_customer: bool(row.bInsuranceCustomer),
      tax_number: clean(row.Tax_Number) || null,
      registration_number: clean(row.Registration) || null,
      primary_contact_name: clean(row.Contact_Person) || null,
      primary_email: clean(row.EMail) || null,
      primary_phone: clean(row.Telephone) || null,
      physical_address: joined(row.Physical1, row.Physical2, row.Physical3, row.Physical4, row.Physical5) || null,
      delivery_address: joined(row.Post1, row.Post2, row.Post3, row.Post4, row.Post5) || null,
      sage_last_synced_at: now,
      updated_at: now,
    }));

    let synced = 0;
    for (let index = 0; index < rows.length; index += 500) {
      const chunk = rows.slice(index, index + 500);
      const { error } = await supabase.from('crm_customers').upsert(chunk, { onConflict: 'sage_customer_code', ignoreDuplicates: false });
      if (error) throw error;
      synced += chunk.length;
      console.log(`  CRM customers synced: ${synced}/${rows.length}`);
    }
    return { read: rows.length, synced };
  } finally {
    await pool.close();
  }
}

module.exports = { syncCrmCustomersFromSage };

if (require.main === module) {
  syncCrmCustomersFromSage()
    .then((result) => { console.log(`CRM customer sync complete: ${result.synced} customer(s).`); process.exit(0); })
    .catch((error) => { console.error(`CRM customer sync failed: ${error.message}`); process.exit(1); });
}
