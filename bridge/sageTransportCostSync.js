// Read-only Sage transporter-cost synchronizer. It imports a constrained PostAP
// slice into PlantControl for reconciliation; it never posts or changes Sage data.

const { supabase } = require('./lib/db');

const SDK_BASE_URL = (process.env.SAGE_SDK_API_BASE_URL || 'http://127.0.0.1:5088').replace(/\/+$/, '');
const SDK_API_KEY = process.env.SAGE_SDK_API_KEY || process.env.HYPER_SAGE_API_KEY;
const LOOKBACK_DAYS = Math.max(1, Math.min(180, Number(process.env.SAGE_TRANSPORT_COST_SYNC_LOOKBACK_DAYS || 120)));
const UPSERT_BATCH_SIZE = 100;

function isoDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function normalise(value) {
  return String(value || '').trim().toUpperCase();
}

function readEntryField(entry, name) {
  const pascalName = name.charAt(0).toUpperCase() + name.slice(1);
  return entry[name] ?? entry[pascalName];
}

async function getJson(url) {
  const response = await fetch(url, { headers: { 'X-Hyper-Api-Key': SDK_API_KEY } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `Sage transporter-cost request failed: HTTP ${response.status}`);
  return body;
}

async function getMappedAccounts() {
  const { data, error } = await supabase
    .from('inbound_transporters')
    .select('sage_supplier_account')
    .eq('is_active', true)
    .not('sage_supplier_account', 'is', null);
  if (error) throw new Error(`Could not load mapped transporter accounts: ${error.message}`);
  return [...new Set((data || []).map((row) => normalise(row.sage_supplier_account)).filter(Boolean))].sort();
}

async function createRun(accounts, fromDate, toDate) {
  const { data, error } = await supabase.from('inbound_transport_sage_sync_runs').insert({
    status: 'running',
    source: 'sage-sdk-postap',
    from_date: fromDate,
    to_date: toDate,
    supplier_accounts: accounts,
    started_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw new Error(`Could not start transporter-cost sync audit: ${error.message}`);
  return data.id;
}

async function finishRun(id, fields) {
  const { error } = await supabase.from('inbound_transport_sage_sync_runs').update({
    ...fields,
    finished_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw new Error(`Could not finish transporter-cost sync audit: ${error.message}`);
}

function toHistoryRow(entry, runId, readAt) {
  const transactionType = String(readEntryField(entry, 'transactionType') || '').trim();
  if (!['APTx', 'CBAP'].includes(transactionType)) throw new Error(`Unexpected Sage PostAP transaction type: ${transactionType || 'blank'}`);
  const supplierAccount = normalise(readEntryField(entry, 'supplierAccount'));
  const auditNumber = String(readEntryField(entry, 'auditNumber') || '').trim();
  if (!supplierAccount || !auditNumber) throw new Error('Sage transporter-cost response contains an entry without supplier account or audit number.');
  return {
    company_database: 'Hyperfeeds 2024',
    supplier_account: supplierAccount,
    transaction_date: String(readEntryField(entry, 'transactionDate') || '').slice(0, 10),
    transaction_type: transactionType,
    description: String(readEntryField(entry, 'description') || '').trim(),
    reference: String(readEntryField(entry, 'reference') || '').trim(),
    batch_reference: String(readEntryField(entry, 'batchReference') || '').trim(),
    audit_number: auditNumber,
    debit: Number(readEntryField(entry, 'debit') || 0),
    credit: Number(readEntryField(entry, 'credit') || 0),
    outstanding_at_extract: Number(readEntryField(entry, 'outstanding') || 0),
    sage_currency_id: Number(readEntryField(entry, 'currencyId') || 0),
    foreign_debit: Number(readEntryField(entry, 'foreignDebit') || 0),
    foreign_credit: Number(readEntryField(entry, 'foreignCredit') || 0),
    sage_auto_index: Number(readEntryField(entry, 'autoIndex')),
    payment_allocations: String(readEntryField(entry, 'paymentAllocations') || ''),
    posting_user: String(readEntryField(entry, 'userName') || '').trim(),
    extracted_at: readAt,
    imported_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    last_sync_run_id: runId,
    source_table: 'PostAP',
  };
}

async function upsertRows(rows) {
  for (let index = 0; index < rows.length; index += UPSERT_BATCH_SIZE) {
    const { error } = await supabase.from('inbound_transport_sage_history').upsert(
      rows.slice(index, index + UPSERT_BATCH_SIZE),
      { onConflict: 'company_database,supplier_account,audit_number,transaction_type' },
    );
    if (error) throw new Error(`Could not import Sage transporter-cost entries: ${error.message}`);
  }
}

async function syncSageTransportCosts() {
  if (!SDK_API_KEY) throw new Error('Missing SAGE_SDK_API_KEY or HYPER_SAGE_API_KEY for transporter-cost sync.');
  const accounts = await getMappedAccounts();
  if (!accounts.length) return { skipped: true, reason: 'No active PlantControl transporters have Sage supplier accounts.' };

  const toDate = isoDate(Date.now() + 24 * 60 * 60 * 1000);
  const fromDate = isoDate(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const runId = await createRun(accounts, fromDate, toDate);
  try {
    const query = new URLSearchParams({ fromDate, toDate, accounts: accounts.join(',') });
    const result = await getJson(`${SDK_BASE_URL}/api/v1/transport-costs?${query.toString()}`);
    if (String(result.companyDatabase || '').trim().toLowerCase() !== 'hyperfeeds 2024') {
      throw new Error(`Unexpected Sage company database: ${result.companyDatabase || 'unknown'}`);
    }
    const entries = Array.isArray(result.entries) ? result.entries : [];
    const unexpected = entries.find((entry) => !accounts.includes(normalise(readEntryField(entry, 'supplierAccount'))));
    if (unexpected) throw new Error(`Sage transporter-cost response included an unapproved supplier account: ${readEntryField(unexpected, 'supplierAccount') || 'blank'}`);
    const readAt = result.readAtUtc || new Date().toISOString();
    await upsertRows(entries.map((entry) => toHistoryRow(entry, runId, readAt)));
    await finishRun(runId, { status: 'success', entry_count: entries.length, message: `Imported ${entries.length} read-only Sage PostAP entry/entries.` });
    return { skipped: false, runId, accounts: accounts.length, entries: entries.length, fromDate, toDate };
  } catch (error) {
    await finishRun(runId, { status: 'failed', message: error.message }).catch((finishError) => console.error(`  Failed to record transporter-cost sync failure: ${finishError.message}`));
    throw error;
  }
}

module.exports = { syncSageTransportCosts, LOOKBACK_DAYS };
