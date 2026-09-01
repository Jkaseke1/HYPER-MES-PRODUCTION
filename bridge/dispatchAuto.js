// Dispatch-to-branch Sage handler. Posts only a confirmed, Finance-released IBT
// through the Evolution SDK; it never writes Sage SQL tables directly.

const http = require('http');
const https = require('https');
const { supabase, DRY_RUN } = require('./lib/db');
const { getSageProductUnitSettings, toSageUnits } = require('./lib/sageProductUnits');

const SDK_BASE_URL = (process.env.SAGE_SDK_API_BASE_URL || 'http://127.0.0.1:5088').replace(/\/+$/, '');
const SDK_API_KEY = process.env.SAGE_SDK_API_KEY || process.env.HYPER_SAGE_API_KEY;

function postJson(urlString, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString); const payload = JSON.stringify(body); const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request({ method: 'POST', hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: `${url.pathname}${url.search}`, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'X-Hyper-Api-Key': SDK_API_KEY } }, (response) => {
      let responseBody = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => { let parsed = {}; try { parsed = responseBody ? JSON.parse(responseBody) : {}; } catch (_) { parsed = { message: responseBody }; }
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(parsed);
        const message = parsed?.exceptionMessage || parsed?.Message || parsed?.message || responseBody || `HTTP ${response.statusCode}`;
        const error = new Error(`Sage branch transfer API failed: ${message}`); error.statusCode = response.statusCode; error.response = parsed; reject(error); });
    });
    request.on('error', (error) => reject(new Error(`Sage branch transfer API connection failed: ${error.message}`))); request.write(payload); request.end();
  });
}

async function handleDispatch(syncEvent) {
  console.log('\n  -> Branch Dispatch Transfer (SDK)');
  if (!SDK_API_KEY) throw new Error('Missing SAGE_SDK_API_KEY or HYPER_SAGE_API_KEY for protected Sage SDK API');
  const { data: dispatch, error } = await supabase.from('dispatch_orders')
    .select('id, dispatch_number, dispatch_type, status, branch_id, branch_confirmation_status, accounts_posting_status, branches(id, name, sage_warehouse_code, sage_warehouse_id), warehouses(code, name)')
    .eq('id', syncEvent.reference_id).single();
  if (error || !dispatch) throw new Error(`Dispatch not found: ${syncEvent.reference_id}`);
  if (dispatch.dispatch_type !== 'branch_transfer') throw new Error(`Dispatch ${dispatch.dispatch_number} is not a branch transfer; direct-customer dispatches require their sales-document workflow.`);
  if (dispatch.status !== 'delivered') throw new Error(`Dispatch ${dispatch.dispatch_number} is not delivered yet.`);
  if (dispatch.branch_confirmation_status !== 'confirmed') throw new Error(`Dispatch ${dispatch.dispatch_number} has not been confirmed by the receiving branch.`);
  if (dispatch.accounts_posting_status !== 'approved') throw new Error(`Dispatch ${dispatch.dispatch_number} has not been released by Finance.`);

  const sourceWarehouse = String(dispatch.warehouses?.code || '').trim().toUpperCase();
  if (!sourceWarehouse || !dispatch.branch_id) throw new Error(`Dispatch ${dispatch.dispatch_number} is missing its source warehouse or destination branch.`);
  const destinationWarehouse = String(dispatch.branches?.sage_warehouse_code || '').trim().toUpperCase();
  const { data: destination, error: destinationError } = await supabase.from('warehouses')
    .select('id, name').eq('code', destinationWarehouse).eq('type', 'finished_goods').eq('is_active', true).maybeSingle();
  if (destinationError) throw new Error(`Could not load the receiving branch warehouse: ${destinationError.message}`);
  if (!destinationWarehouse) throw new Error(`The finished-goods warehouse for ${dispatch.branches?.name || 'this branch'} has no Sage warehouse code. Configure it before releasing this dispatch.`);

  const { data: items, error: itemsError } = await supabase.from('dispatch_items')
    .select('id, quantity, unit, formulations(id, name, sage_code)').eq('dispatch_order_id', dispatch.id);
  if (itemsError || !items?.length) throw new Error(`No items found for dispatch ${dispatch.dispatch_number}`);
  const posted = [];
  for (const item of items) {
    const itemCode = String(item.formulations?.sage_code || '').trim().toUpperCase(); const quantityKg = Number(item.quantity || 0);
    if (!itemCode) throw new Error('A dispatch line has no Sage item code.');
    if (!Number.isFinite(quantityKg) || quantityKg <= 0) throw new Error(`Invalid quantity for ${itemCode}: ${item.quantity}`);
    const { kgPerSageUnit } = await getSageProductUnitSettings(supabase, item.formulations?.id, itemCode);
    const sageUnits = toSageUnits(quantityKg, kgPerSageUnit, itemCode);
    const body = { itemCode, fromWarehouse: sourceWarehouse, toWarehouse: destinationWarehouse, quantity: sageUnits, reference: dispatch.dispatch_number, reference2: `MES IBT ${dispatch.branches?.name || dispatch.branch_id}`.substring(0, 50), confirmPost: true };
    console.log(`  ${itemCode}: ${quantityKg}kg (${sageUnits} Sage unit(s) x ${kgPerSageUnit}kg) ${sourceWarehouse} -> ${destinationWarehouse}`);
    if (!DRY_RUN) await postJson(`${SDK_BASE_URL}/api/v1/warehouse-transfers/post`, body);
    posted.push({ itemCode, quantityKg, kgPerSageUnit, sageUnits, body });
  }
  return { message: `Posted branch transfer ${dispatch.dispatch_number}: ${posted.length} item(s) from ${sourceWarehouse} to ${destinationWarehouse}.`, details: { sdkBranchDispatchTransfer: { dispatchNumber: dispatch.dispatch_number, sourceWarehouse, destinationWarehouse, destinationWarehouseId: dispatch.branches?.sage_warehouse_id || null, items: posted } } };
}

module.exports = { handleDispatch };
