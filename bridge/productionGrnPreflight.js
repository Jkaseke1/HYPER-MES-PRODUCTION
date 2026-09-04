// Read-only readiness check for the Production GRN-only Sage rollout.

const http = require('http');
const https = require('https');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const EXPECTED_EVENT_TYPE = 'grn_confirmed';
const SDK_BASE_URL = (process.env.SAGE_SDK_API_BASE_URL || 'http://127.0.0.1:5088').replace(/\/+$/, '');
const SDK_API_KEY = process.env.SAGE_SDK_API_KEY || process.env.HYPER_SAGE_API_KEY;
let supabase;

function fail(message) {
  throw new Error(message);
}

function requireSetting(name, value) {
  if (!value || !String(value).trim()) fail(`Missing ${name}`);
  return String(value).trim();
}

function getJson(urlString) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request({
      method: 'GET',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers: { 'X-Hyper-Api-Key': SDK_API_KEY },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        let parsed = {};
        try { parsed = body ? JSON.parse(body) : {}; } catch (_) { parsed = { message: body }; }
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(parsed);
        reject(new Error(parsed.message || `HTTP ${response.statusCode}`));
      });
    });
    request.on('error', reject);
    request.end();
  });
}

async function counted(table, configure) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  if (configure) query = configure(query);
  const { count, error } = await query;
  if (error) fail(`${table} check failed: ${error.message}`);
  return count || 0;
}

async function run() {
  console.log('PlantControl Production GRN preflight (read-only)');
  console.log('No Sage or Supabase records will be changed.\n');

  const supabaseUrl = requireSetting('SUPABASE_URL', process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const supabaseKey = requireSetting('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  requireSetting('SAGE_SDK_API_KEY', SDK_API_KEY);
  supabase = createClient(supabaseUrl, supabaseKey);

  const allowed = (process.env.BRIDGE_ALLOWED_EVENT_TYPES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (allowed.length !== 1 || allowed[0] !== EXPECTED_EVENT_TYPE) {
    fail(`BRIDGE_ALLOWED_EVENT_TYPES must be exactly ${EXPECTED_EVENT_TYPE}`);
  }
  if (process.env.BRIDGE_ENFORCE_GRN_ONLY !== 'true') fail('BRIDGE_ENFORCE_GRN_ONLY must be true');
  if (process.env.DRY_RUN !== 'true') fail('DRY_RUN must be true during preflight');
  if (process.env.SAGE_STOCK_SYNC_ENABLED !== 'false') {
    fail('SAGE_STOCK_SYNC_ENABLED must be false until Sage reconciliation is approved');
  }
  console.log('PASS  Bridge scope: GRN only, dry-run, stock sync disabled');

  const [pendingGrns, pendingOther, failedGrns, approvedGrns] = await Promise.all([
    counted('sync_log', (query) => query.eq('status', 'pending').eq('event_type', EXPECTED_EVENT_TYPE)),
    counted('sync_log', (query) => query.eq('status', 'pending').neq('event_type', EXPECTED_EVENT_TYPE)),
    counted('sync_log', (query) => query.eq('status', 'failed').eq('event_type', EXPECTED_EVENT_TYPE)),
    counted('goods_received_notes', (query) => query.eq('status', 'approved')),
  ]);
  console.log(`PASS  Production Supabase reachable`);
  console.log(`INFO  GRN queue: ${pendingGrns} pending, ${failedGrns} failed, ${approvedGrns} approved`);
  console.log(`INFO  Other pending event types ignored by GRN worker: ${pendingOther}`);

  const connection = await getJson(`${SDK_BASE_URL}/api/v1/sdk/connection`);
  const expectedEnvironment = requireSetting('SAGE_EXPECTED_ENVIRONMENT', process.env.SAGE_EXPECTED_ENVIRONMENT);
  const expectedDatabase = requireSetting('SAGE_EXPECTED_COMPANY_DATABASE', process.env.SAGE_EXPECTED_COMPANY_DATABASE);
  const actualEnvironment = String(connection.environment || '').trim();
  const actualDatabase = String(connection.companyDatabase || '').trim();
  if (actualEnvironment.toLowerCase() !== expectedEnvironment.toLowerCase()) {
    fail(`SDK environment is ${actualEnvironment || 'unknown'}, expected ${expectedEnvironment}`);
  }
  if (actualDatabase.toLowerCase() !== expectedDatabase.toLowerCase()) {
    fail(`SDK company database is ${actualDatabase || 'unknown'}, expected ${expectedDatabase}`);
  }
  console.log(`PASS  Sage SDK connected to ${actualEnvironment} / ${actualDatabase}`);
  console.log('\nREADY FOR CONTROLLED DRY-RUN. Posting remains disabled.');
}

run().catch((error) => {
  console.error(`\nBLOCKED: ${error.message}`);
  process.exitCode = 1;
});
