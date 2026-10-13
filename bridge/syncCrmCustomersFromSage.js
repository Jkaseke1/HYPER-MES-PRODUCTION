// Pull Sage Pastel customer master data into the HYPERFEEDS CRM.
// Sage is authoritative for account/contact/credit fields. CRM-owned fields
// such as segment, owner, health, notes and next action are not overwritten.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', 'sage-sdk-api', '.env') });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error('Missing SUPABASE_URL and SUPABASE_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY');

const sdkBaseUrl = (process.env.SAGE_SDK_API_BASE_URL || 'http://127.0.0.1:5090').replace(/\/+$/, '');
const sdkApiKey = process.env.SAGE_SDK_API_KEY || process.env.HYPER_SAGE_API_KEY;
if (!sdkApiKey) throw new Error('Missing SAGE_SDK_API_KEY/HYPER_SAGE_API_KEY for the local Sage SDK API');
const syncEnabled = process.env.SAGE_CRM_CUSTOMER_SYNC_ENABLED === 'true';

const supabase = createClient(supabaseUrl, supabaseKey);
const clean = (value) => String(value ?? '').trim();
const bool = (value) => value === true || value === 1 || clean(value).toLowerCase() === 'true';
const joined = (...values) => values.map(clean).filter(Boolean).join(', ');

function cleanChangedSince(value) {
  const normalized = clean(value);
  if (!normalized) return null;
  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error('SAGE_CRM_CUSTOMER_CHANGED_SINCE must be an ISO-8601 date or timestamp.');
  }
  return normalized;
}

const changedSince = cleanChangedSince(process.env.SAGE_CRM_CUSTOMER_CHANGED_SINCE);

function enforceSdkIdentity(body) {
  if (process.env.BRIDGE_ENFORCE_SAGE_IDENTITY !== 'true') return;
  const expectedEnvironment = clean(process.env.SAGE_EXPECTED_ENVIRONMENT);
  const expectedDatabase = clean(process.env.SAGE_EXPECTED_COMPANY_DATABASE);
  if (!expectedEnvironment || !expectedDatabase) {
    throw new Error('Sage identity enforcement requires SAGE_EXPECTED_ENVIRONMENT and SAGE_EXPECTED_COMPANY_DATABASE.');
  }
  if (clean(body.environment).toLowerCase() !== expectedEnvironment.toLowerCase()) {
    throw new Error(`Sage CRM source environment is ${body.environment || 'unknown'}, expected ${expectedEnvironment}.`);
  }
  if (clean(body.companyDatabase).toLowerCase() !== expectedDatabase.toLowerCase()) {
    throw new Error(`Sage CRM source database is ${body.companyDatabase || 'unknown'}, expected ${expectedDatabase}.`);
  }
}

async function createSyncRun() {
  const { data, error } = await supabase
    .from('crm_sage_sync_runs')
    .insert({ source_endpoint: '/api/v1/crm/customers', changed_since: changedSince })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function completeSyncRun(id, update) {
  const { error } = await supabase
    .from('crm_sage_sync_runs')
    .update({ ...update, finished_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

function classifySegment(row) {
  const source = [row.groupDescription, row.areaDescription, row.name].map(clean).join(' ').toLowerCase();
  const smallScalePattern = new RegExp(process.env.SAGE_CRM_SMALL_SCALE_PATTERN || 'small[- ]?scale|farmer|grower');
  const dealerPattern = new RegExp(process.env.SAGE_CRM_DEALER_PATTERN || 'dealer|agent|distributor');
  if (smallScalePattern.test(source)) return 'small_scale';
  if (dealerPattern.test(source)) return 'dealer';
  return 'commercial';
}

async function syncCrmCustomersFromSage() {
  if (!syncEnabled) {
    throw new Error('CRM customer sync is disabled. Set SAGE_CRM_CUSTOMER_SYNC_ENABLED=true after the audit migration is applied.');
  }

  const syncRunId = await createSyncRun();
  const customers = [];
  let synced = 0;
  let source;
  try {
    for (let page = 1; ; page += 1) {
      const query = new URLSearchParams({ page: String(page), pageSize: '500' });
      if (changedSince) query.set('changedSince', changedSince);
      const response = await fetch(`${sdkBaseUrl}/api/v1/crm/customers?${query}`, {
        headers: { 'X-Hyper-Api-Key': sdkApiKey },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || `Sage CRM customer request failed: HTTP ${response.status}`);
      enforceSdkIdentity(body);
      source = body;
      const pageCustomers = Array.isArray(body.customers) ? body.customers : [];
      customers.push(...pageCustomers);
      if (!body.hasMore) break;
    }

    const { data: existingCustomers, error: existingError } = await supabase
      .from('crm_customers')
      .select('sage_customer_code, segment, lifecycle_stage, health_status, account_owner, notes, next_action, next_contact_at');
    if (existingError) throw existingError;
    const existingByCode = new Map((existingCustomers || []).map((customer) => [clean(customer.sage_customer_code).toUpperCase(), customer]));
    const now = new Date().toISOString();
    const rows = customers.map((row) => {
      const sageCode = clean(row.account);
      const existing = existingByCode.get(sageCode.toUpperCase());
      return {
      sage_customer_id: row.sageCustomerId,
      sage_customer_code: sageCode,
      legal_name: clean(row.name) || clean(row.account),
      customer_type: 'customer',
      segment: existing?.segment || classifySegment(row),
      lifecycle_stage: existing?.lifecycle_stage || (bool(row.onHold) ? 'blocked' : 'active'),
      health_status: existing?.health_status || 'healthy',
      account_owner: existing?.account_owner || null,
      notes: existing?.notes || null,
      next_action: existing?.next_action || null,
      next_contact_at: existing?.next_contact_at || null,
      status: bool(row.onHold) ? 'blocked' : 'active',
      customer_group: clean(row.groupDescription) || null,
      area: clean(row.areaDescription) || null,
      sage_rep_code: clean(row.repCode) || null,
      sage_rep_name: clean(row.repName) || null,
      currency_code: clean(row.currencyCode) || null,
      payment_terms: clean(row.accountTerms) || null,
      credit_limit: row.creditLimit ?? null,
      account_balance: row.accountBalance ?? null,
      on_hold: bool(row.onHold),
      cash_customer: bool(row.cashDebtor),
      cash_on_delivery_customer: bool(row.cashOnDelivery),
      insurance_customer: bool(row.insuranceCustomer),
      tax_number: clean(row.taxNumber) || null,
      registration_number: clean(row.registration) || null,
      primary_contact_name: clean(row.contactPerson) || null,
      primary_email: clean(row.email) || null,
      primary_phone: clean(row.telephone) || null,
      physical_address: joined(...(row.physical || [])) || null, delivery_address: joined(...(row.postal || [])) || null,
      sage_last_synced_at: now,
      updated_at: now,
      };
    });

    for (let index = 0; index < rows.length; index += 500) {
      const chunk = rows.slice(index, index + 500);
      const { error } = await supabase.from('crm_customers').upsert(chunk, { onConflict: 'sage_customer_code', ignoreDuplicates: false });
      if (error) throw error;
      synced += chunk.length;
      console.log(`  CRM customers synced: ${synced}/${rows.length}`);
    }
    await completeSyncRun(syncRunId, {
      status: 'success',
      sage_environment: clean(source?.environment) || null,
      sage_company_database: clean(source?.companyDatabase) || null,
      customers_read: customers.length,
      customers_synced: synced,
    });
    return { read: rows.length, synced };
  } catch (error) {
    await completeSyncRun(syncRunId, {
      status: 'failed',
      customers_read: customers.length,
      customers_synced: synced,
      error_message: error.message,
    }).catch((auditError) => console.error(`CRM sync audit failure: ${auditError.message}`));
    throw error;
  }
}

module.exports = { syncCrmCustomersFromSage };

if (require.main === module) {
  syncCrmCustomersFromSage()
    .then((result) => { console.log(`CRM customer sync complete: ${result.synced} customer(s).`); process.exit(0); })
    .catch((error) => { console.error(`CRM customer sync failed: ${error.message}`); process.exit(1); });
}
