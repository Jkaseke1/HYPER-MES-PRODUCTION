// Read-only Power BI aligned sales-tonnage import. No Sage writes are possible here.
const { supabase } = require('./lib/db');
const BASE_URL = (process.env.SAGE_SDK_API_BASE_URL || 'http://127.0.0.1:5088').replace(/\/+$/, '');
const API_KEY = process.env.SAGE_SDK_API_KEY || process.env.HYPER_SAGE_API_KEY;
const LOOKBACK_DAYS = Math.max(1, Math.min(366, Number(process.env.SAGE_SOLD_TONNAGE_SYNC_LOOKBACK_DAYS || 120)));
const isoDate = (date) => new Date(date).toISOString().slice(0, 10);
const field = (entry, name) => entry[name] ?? entry[name.charAt(0).toUpperCase() + name.slice(1)] ?? '';

async function syncSageSoldTonnage() {
  if (!API_KEY) throw new Error('Missing SAGE_SDK_API_KEY for sold-tonnage sync.');
  const toDate = isoDate(Date.now() + 86400000);
  const fromDate = isoDate(Date.now() - LOOKBACK_DAYS * 86400000);
  const response = await fetch(`${BASE_URL}/api/v1/reporting/sold-tonnage?${new URLSearchParams({ fromDate, toDate })}`, { headers: { 'X-Hyper-Api-Key': API_KEY } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || `Sage sold-tonnage request failed: HTTP ${response.status}`);
  const rows = (Array.isArray(result.entries) ? result.entries : []).map((entry) => ({
    invoice_date: String(field(entry, 'invoiceDate')).slice(0, 10), warehouse_code: String(field(entry, 'warehouseCode')).trim(), warehouse_name: String(field(entry, 'warehouseName')).trim(),
    category: String(field(entry, 'category')).trim(), sub_category: String(field(entry, 'subCategory')).trim(), reporting_category: String(field(entry, 'reportingCategory')).trim(), transaction_type: String(field(entry, 'transactionType')).trim(),
    total_tonnes: Number(field(entry, 'totalTonnes') || 0), total_sales_amount: Number(field(entry, 'totalSalesAmount') || 0), line_count: Number(field(entry, 'lineCount') || 0), imported_at: new Date().toISOString(), source_read_at: result.readAtUtc || new Date().toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from('sage_sold_tonnage_daily').upsert(rows.slice(i, i + 100), { onConflict: 'invoice_date,warehouse_code,category,sub_category,reporting_category,transaction_type' });
    if (error) throw new Error(`Could not import Sage sold-tonnage rows: ${error.message}`);
  }
  return { entries: rows.length, fromDate, toDate };
}
module.exports = { syncSageSoldTonnage };
