// Posts a Sage-confirmed return of one completed material-transfer line: PD -> RM.

const http = require('http');
const https = require('https');
const { supabase, DRY_RUN } = require('./lib/db');

const SDK_BASE_URL = (process.env.SAGE_SDK_API_BASE_URL || 'http://127.0.0.1:5088').replace(/\/+$/, '');
const SDK_API_KEY = process.env.SAGE_SDK_API_KEY || process.env.HYPER_SAGE_API_KEY;

function postJson(urlString, apiKey, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = JSON.stringify(body);
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request({
      method: 'POST', hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'X-Hyper-Api-Key': apiKey },
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => {
        let parsed = responseBody;
        try { parsed = responseBody ? JSON.parse(responseBody) : {}; } catch (_) { /* retain text diagnostics */ }
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(parsed);
        const message = parsed?.exceptionMessage || parsed?.Message || parsed?.message || responseBody || `HTTP ${response.statusCode}`;
        const error = new Error(`Sage SDK API failed: ${message}`);
        error.statusCode = response.statusCode;
        error.response = parsed;
        reject(error);
      });
    });
    request.on('error', (error) => reject(new Error(`Sage SDK API connection failed: ${error.message}`)));
    request.write(payload);
    request.end();
  });
}

async function handleMaterialTransferReturnToRm(event) {
  if (!SDK_API_KEY) throw new Error('Missing SAGE_SDK_API_KEY or HYPER_SAGE_API_KEY for protected Sage SDK API');

  const { data: reversal, error } = await supabase
    .from('material_transfer_reversals')
    .select(`
      id, reversal_number, quantity, unit, sage_reference, sage_reference2, status, requested_by,
      raw_materials ( id, name, code, sage_code )
    `)
    .eq('id', event.reference_id)
    .single();
  if (error || !reversal) throw new Error(`Material transfer return not found: ${event.reference_id} - ${error?.message || 'no row returned'}`);
  if (!['pending', 'processing'].includes(reversal.status)) throw new Error(`Material transfer return ${reversal.reversal_number} is not pending; current status is ${reversal.status}`);

  const sageCode = reversal.raw_materials?.sage_code || reversal.raw_materials?.code;
  const quantity = Number(reversal.quantity || 0);
  if (!sageCode) throw new Error(`No Sage code for returned material ${reversal.raw_materials?.name || reversal.id}`);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Invalid return quantity: ${reversal.quantity}`);

  let userName = 'PlantControl';
  if (reversal.requested_by) {
    const { data: requester, error: requesterError } = await supabase
      .from('profiles').select('full_name,email').eq('id', reversal.requested_by).maybeSingle();
    if (requesterError) throw new Error(`Return requester profile query failed: ${requesterError.message}`);
    userName = (requester?.full_name || requester?.email?.split('@')[0] || 'PlantControl').trim();
  }

  const body = {
    itemCode: sageCode,
    fromWarehouse: 'PD',
    toWarehouse: 'RM',
    quantity,
    reference: reversal.sage_reference,
    reference2: reversal.sage_reference2,
    userName: userName.substring(0, 50),
    confirmPost: true,
  };

  if (DRY_RUN) {
    return {
      dryRun: true,
      message: `DRY RUN: ${body.reference} would return ${sageCode} from PD to RM through Sage SDK`,
      details: { sdkTransfer: { ...body, confirmPost: false } },
    };
  }

  const result = await postJson(`${SDK_BASE_URL}/api/v1/warehouse-transfers/post`, SDK_API_KEY, body);
  const { error: finalizeError } = await supabase.rpc('finalize_material_transfer_return_to_rm', { p_reversal_id: reversal.id });
  if (finalizeError) throw new Error(`Sage posted ${reversal.reversal_number}, but PlantControl could not finalize the return: ${finalizeError.message}`);

  return {
    message: `Posted to Sage: ${body.reference} returned ${sageCode} ${quantity}${reversal.unit || 'kg'} from PD to RM`,
    sage_response: result,
    details: { sdkTransfer: body, sageStatus: result.status || 'posted', sageMessage: result.message || null },
  };
}

module.exports = { handleMaterialTransferReturnToRm };
