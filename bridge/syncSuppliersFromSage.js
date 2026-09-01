// syncSuppliersFromSage.js - Pull Sage Vendor master into MES suppliers.
// Keeps MES supplier code and sage_code aligned to the Sage Vendor.Account.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', 'sage-sdk-api', '.env') });

const sql = require('mssql');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL and SUPABASE_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY');
}

const sageConfig = {
  server: process.env.SAGE_SERVER || process.env.HYPER_SAGE_SERVER || 'localhost',
  port: Number(process.env.SAGE_PORT || 1433),
  database: process.env.SAGE_DATABASE || process.env.HYPER_SAGE_COMPANY_DATABASE,
  user: process.env.SAGE_USER || process.env.HYPER_SAGE_SQL_USERNAME,
  password: process.env.SAGE_PASSWORD || process.env.HYPER_SAGE_SQL_PASSWORD,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
};

if (!sageConfig.database || !sageConfig.user || !sageConfig.password) {
  throw new Error('Missing SAGE_DATABASE, SAGE_USER, or SAGE_PASSWORD');
}

const supabase = createClient(supabaseUrl, supabaseKey);
const clean = (value) => String(value || '').trim();

async function syncSuppliersFromSage() {
  console.log('Syncing Sage Vendor suppliers into MES...');

  const pool = await sql.connect(sageConfig);
  const result = await pool.request().query(`
    SELECT
      DCLink,
      LTRIM(RTRIM(Account)) AS Account,
      LTRIM(RTRIM(Name)) AS Name,
      LTRIM(RTRIM(Contact_Person)) AS Contact_Person,
      LTRIM(RTRIM(EMail)) AS EMail,
      LTRIM(RTRIM(Telephone)) AS Telephone,
      LTRIM(RTRIM(Physical1)) AS Physical1,
      LTRIM(RTRIM(Physical2)) AS Physical2,
      LTRIM(RTRIM(Physical3)) AS Physical3,
      LTRIM(RTRIM(Physical4)) AS Physical4,
      LTRIM(RTRIM(Physical5)) AS Physical5,
      COALESCE(On_Hold, 0) AS On_Hold
    FROM Vendor
    WHERE Account IS NOT NULL
      AND LTRIM(RTRIM(Account)) <> ''
    ORDER BY Account
  `);

  const now = new Date().toISOString();
  const suppliers = result.recordset.map((row) => ({
    code: clean(row.Account),
    sage_code: clean(row.Account),
    name: clean(row.Name) || clean(row.Account),
    contact_person: clean(row.Contact_Person),
    email: clean(row.EMail),
    phone: clean(row.Telephone),
    address: [
      row.Physical1,
      row.Physical2,
      row.Physical3,
      row.Physical4,
      row.Physical5,
    ].map(clean).filter(Boolean).join(', '),
    payment_terms: '',
    is_active: !row.On_Hold,
    updated_at: now,
  }));

  let synced = 0;
  for (let i = 0; i < suppliers.length; i += 500) {
    const chunk = suppliers.slice(i, i + 500);
    const { error } = await supabase
      .from('suppliers')
      .upsert(chunk, { onConflict: 'code', ignoreDuplicates: false });

    if (error) throw error;
    synced += chunk.length;
    console.log(`  Synced ${synced}/${suppliers.length}`);
  }

  const { data: check, error: checkError } = await supabase
    .from('suppliers')
    .select('code, sage_code, name, is_active')
    .eq('sage_code', 'CHI0008')
    .limit(1);

  if (checkError) throw checkError;

  console.log(`Done. Sage suppliers read: ${suppliers.length}`);
  console.table(check || []);

  await sql.close();
}

module.exports = { syncSuppliersFromSage };

if (require.main === module) {
  syncSuppliersFromSage()
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error('ERROR:', err.message);
      try { await sql.close(); } catch (_) {}
      process.exit(1);
    });
}
