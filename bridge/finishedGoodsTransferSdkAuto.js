// Posts clerk-approved finished-goods transfers from Sage Production to Dispatch.

const http = require('http');
const https = require('https');
const { supabase, DRY_RUN } = require('./lib/db');
const { getSageProductUnitSettings, toSageUnits } = require('./lib/sageProductUnits');

const SDK_BASE_URL = (process.env.SAGE_SDK_API_BASE_URL || 'http://127.0.0.1:5088').replace(/\/+$/, '');
const SDK_API_KEY = process.env.SAGE_SDK_API_KEY || process.env.HYPER_SAGE_API_KEY;

function postJson(urlString, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = JSON.stringify(body);
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request({
      method: 'POST', hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: `${url.pathname}${url.search}`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'X-Hyper-Api-Key': SDK_API_KEY },
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => {
        let parsed = {};
        try { parsed = responseBody ? JSON.parse(responseBody) : {}; } catch (_) { parsed = { message: responseBody }; }
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(parsed);
        const message = parsed?.exceptionMessage || parsed?.Message || parsed?.message || responseBody || `HTTP ${response.statusCode}`;
        const error = new Error(`Sage finished-goods transfer API failed: ${message}`);
        error.statusCode = response.statusCode;
        error.response = parsed;
        reject(error);
      });
    });
    request.on('error', (error) => reject(new Error(`Sage finished-goods transfer API connection failed: ${error.message}`)));
    request.write(payload);
    request.end();
  });
}

async function handleFinishedGoodsTransfer(event) {
  console.log('\n  -> Finished Goods Transfer to Dispatch (SDK)');
  if (!SDK_API_KEY) throw new Error('Missing SAGE_SDK_API_KEY or HYPER_SAGE_API_KEY for protected Sage SDK API');

  const { data: transfer, error } = await supabase
    .from('finished_goods_transfers')
    .select('id, transfer_number, quantity, unit, transfer_date, notes, status, formulations(id, name, sage_code), production_orders(batch_number)')
    .eq('id', event.reference_id)
    .single();
  if (error || !transfer) throw new Error(`Finished-goods transfer not found: ${event.reference_id}`);
  if (transfer.status !== 'pending') throw new Error(`Finished-goods transfer ${transfer.transfer_number} is not pending; current status is ${transfer.status}`);

  const itemCode = (transfer.formulations?.sage_code || '').trim();
  const quantity = Number(transfer.quantity || 0);
  if (!itemCode) throw new Error(`No Sage code for finished good ${transfer.formulations?.name || transfer.id}`);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Invalid finished-goods transfer quantity: ${transfer.quantity}`);
  const { kgPerSageUnit } = await getSageProductUnitSettings(supabase, transfer.formulations?.id, itemCode);
  const sageUnits = toSageUnits(quantity, kgPerSageUnit, itemCode);

  const body = {
    itemCode,
    fromWarehouse: 'PD',
    toWarehouse: 'DEB',
    quantity: sageUnits,
    reference: transfer.transfer_number,
    reference2: `MES FG transfer ${transfer.production_orders?.batch_number || transfer.id}`.substring(0, 50),
    confirmPost: true,
  };
  console.log(`  Finished good: ${itemCode} - ${quantity}${transfer.unit || 'kg'} (${sageUnits} Sage unit(s) x ${kgPerSageUnit}kg) PD -> DEB`);

  if (DRY_RUN) return { dryRun: true, message: `DRY RUN: ${body.reference} would move ${itemCode} from PD to DEB`, details: { sdkFinishedGoodsTransfer: { ...body, confirmPost: false } } };

  const result = await postJson(`${SDK_BASE_URL}/api/v1/warehouse-transfers/post`, body);
  const { error: updateError } = await supabase.from('finished_goods_transfers').update({ status: 'posted', sage_response: result, posted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', transfer.id);
  if (updateError) throw new Error(`Sage posted but MES could not mark the finished-goods transfer: ${updateError.message}`);

  return { message: `Posted ${quantity}${transfer.unit || 'kg'} (${sageUnits} Sage unit(s)) of ${itemCode} from Production to DEB`, sage_response: result, details: { sdkFinishedGoodsTransfer: body, quantityKg: quantity, kgPerSageUnit, sageStatus: result.status || 'posted' } };
}

module.exports = { handleFinishedGoodsTransfer };
