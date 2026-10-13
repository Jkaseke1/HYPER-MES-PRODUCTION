// Read-only Sage customer-sales import for PlantControl CRM health reporting.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const sdkBaseUrl = (process.env.SAGE_SDK_API_BASE_URL || 'http://127.0.0.1:5090').replace(/\/+$/, '');
const sdkApiKey = process.env.SAGE_SDK_API_KEY || process.env.HYPER_SAGE_API_KEY;
if (!supabaseUrl || !supabaseKey || !sdkApiKey) throw new Error('CRM sales sync is missing Supabase or Sage SDK configuration.');

const supabase = createClient(supabaseUrl, supabaseKey);
const lookbackDays = Math.max(30, Math.min(366, Number(process.env.SAGE_CRM_SALES_LOOKBACK_DAYS || 180)));
const isoDate = (value) => new Date(value).toISOString().slice(0, 10);

async function syncCrmCustomerSalesFromSage() {
  const toDate = isoDate(Date.now() + 86400000);
  const fromDate = isoDate(Date.now() - lookbackDays * 86400000);
  const all = [];
  let source;
  for (let page = 1; ; page += 1) {
    const query = new URLSearchParams({ fromDate, toDate, page: String(page), pageSize: '1000' });
    const response = await fetch(`${sdkBaseUrl}/api/v1/crm/customer-sales?${query}`, { headers: { 'X-Hyper-Api-Key': sdkApiKey } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `Sage CRM sales request failed: HTTP ${response.status}`);
    source = body;
    all.push(...(Array.isArray(body.entries) ? body.entries : []));
    if (!body.hasMore) break;
  }

  const now = new Date().toISOString();
  const rows = all.map((entry) => ({
    invoice_date: String(entry.invoiceDate).slice(0, 10),
    sage_customer_code: String(entry.customerCode || '').trim(),
    sage_customer_name: String(entry.customerName || '').trim(),
    sales_channel: String(entry.salesChannel || '').trim(),
    document_count: Number(entry.documentCount || 0),
    total_sales_amount: Number(entry.totalSalesAmount || 0),
    source_read_at: source?.readAtUtc || now,
    imported_at: now,
  })).filter((row) => row.invoice_date && row.sage_customer_code && row.sales_channel);

  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await supabase.from('crm_customer_sales_daily').upsert(rows.slice(index, index + 500), {
      onConflict: 'invoice_date,sage_customer_code,sales_channel', ignoreDuplicates: false,
    });
    if (error) throw new Error(`Could not import CRM sales: ${error.message}`);
  }
  console.log(`CRM customer-sales sync complete: ${rows.length} daily customer records from ${source?.companyDatabase || 'Sage'}.`);
  return { fromDate, toDate, imported: rows.length };
}

module.exports = { syncCrmCustomerSalesFromSage };
if (require.main === module) syncCrmCustomerSalesFromSage().catch((error) => { console.error(`CRM customer-sales sync failed: ${error.message}`); process.exit(1); });
