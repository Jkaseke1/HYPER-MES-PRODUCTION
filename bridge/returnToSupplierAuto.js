// Posts Finance-approved return-to-supplier documents through the protected Sage SDK API.
const http = require('http');
const https = require('https');
const { supabase, DRY_RUN } = require('./lib/db');

const SDK_BASE_URL = (process.env.SAGE_SDK_API_BASE_URL || 'http://127.0.0.1:5088').replace(/\/+$/, '');
const SDK_API_KEY = process.env.SAGE_SDK_API_KEY || process.env.HYPER_SAGE_API_KEY;

function postJson(urlString, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = JSON.stringify(body);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({ method: 'POST', hostname: url.hostname, port: url.port || 80, path: url.pathname, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'X-Hyper-Api-Key': SDK_API_KEY } }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        let parsed = responseBody;
        try { parsed = responseBody ? JSON.parse(responseBody) : {}; } catch (_) { /* preserve text */ }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        reject(new Error(parsed?.exceptionMessage || parsed?.message || responseBody || `HTTP ${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function handleReturnToSupplier(event) {
  const { data: rts, error } = await supabase.from('return_to_supplier_requests').select(`
    id, rts_number, original_grn_number, supplier_id, warehouse_id, reason, status,
    suppliers (sage_code, code), warehouses (code),
    return_to_supplier_items (quantity, unit_cost, batch_number, raw_materials (sage_code, code))
  `).eq('id', event.reference_id).single();
  if (error || !rts) throw new Error(`RTS not found: ${event.reference_id}`);
  if (rts.status === 'posted') return { message: 'RTS already posted; duplicate skipped.', details: { alreadyPosted: true } };
  if (rts.status !== 'approved') throw new Error(`RTS ${rts.rts_number} is not Finance-approved.`);
  if (!SDK_API_KEY) throw new Error('Missing Sage SDK API key.');

  const { data: originalGrnSync } = await supabase
    .from('sync_log')
    .select('sage_response')
    .eq('event_type', 'grn_confirmed')
    .eq('reference_id', rts.original_grn_id)
    .eq('status', 'success')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const body = {
    returnReference: rts.rts_number,
    supplierCode: rts.suppliers?.sage_code || rts.suppliers?.code || '',
    originalGrnReference: rts.original_grn_number,
    originalSageGrvNumber: event.details?.originalSageGrvNumber || originalGrnSync?.sage_response?.grvNumber || originalGrnSync?.sage_response?.documentNumber || '',
    reason: rts.reason,
    transactionDate: new Date().toISOString(),
    lines: (rts.return_to_supplier_items || []).map((line) => ({
      itemCode: line.raw_materials?.sage_code || line.raw_materials?.code,
      warehouseCode: rts.warehouses?.code || 'RM',
      quantity: Number(line.quantity),
      unitCost: Number(line.unit_cost || 0),
    })),
    confirmPost: !DRY_RUN,
  };
  if (!body.supplierCode || body.lines.length === 0) throw new Error('RTS is missing a Sage supplier or line item.');
  if (DRY_RUN) return { message: `DRY RUN: would post ${rts.rts_number} to Sage.`, details: { sdkReturnToSupplier: body } };

  await supabase.from('return_to_supplier_requests').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', rts.id).eq('status', 'approved');
  const result = await postJson(`${SDK_BASE_URL}/api/v1/returns/post`, body);
  const sageNumber = result.returnNumber || result.invoiceNumber || result.documentNumber || null;
  const { error: updateError } = await supabase.from('return_to_supplier_requests').update({ status: 'posted', sage_rts_number: sageNumber, posted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', rts.id).eq('status', 'processing');
  if (updateError) throw new Error(`Sage RTS posted but MES could not record it: ${updateError.message}`);
  return { message: `${rts.rts_number} posted to Sage${sageNumber ? ` as ${sageNumber}` : ''}.`, sage_response: result, details: { sdkReturnToSupplier: body, sageRtsNumber: sageNumber } };
}

module.exports = { handleReturnToSupplier };
