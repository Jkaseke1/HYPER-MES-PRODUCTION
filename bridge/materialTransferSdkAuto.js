// materialTransferSdkAuto.js - Posts approved RM -> Production transfers via Sage SDK API
// Reads material_transfers by reference_id from sync_log and avoids direct Sage SQL writes.

const http = require('http');
const https = require('https');
const { supabase, DRY_RUN } = require('./lib/db');

const DEFAULT_SDK_BASE_URL = 'http://127.0.0.1:5088';
const SDK_BASE_URL = (process.env.SAGE_SDK_API_BASE_URL || DEFAULT_SDK_BASE_URL).replace(/\/+$/, '');
const SDK_API_KEY = process.env.SAGE_SDK_API_KEY || process.env.HYPER_SAGE_API_KEY;

function postJson(urlString, apiKey, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = JSON.stringify(body);
    const transport = url.protocol === 'https:' ? https : http;

    const req = transport.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'X-Hyper-Api-Key': apiKey,
        },
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          let parsed = responseBody;
          try {
            parsed = responseBody ? JSON.parse(responseBody) : {};
          } catch (_) {
            // Keep plain text responses intact for diagnostics.
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
            return;
          }

          const message = parsed?.exceptionMessage || parsed?.Message || parsed?.message || responseBody || `HTTP ${res.statusCode}`;
          const error = new Error(`Sage SDK API failed: ${message}`);
          error.statusCode = res.statusCode;
          error.response = parsed;
          reject(error);
        });
      }
    );

    req.on('error', (err) => {
      reject(new Error(`Sage SDK API connection failed: ${err.message}`));
    });

    req.write(payload);
    req.end();
  });
}

function buildReference(transfer) {
  const transferNumber = (transfer.transfer_number || '').trim();
  if (transferNumber) return transferNumber;
  return `MT-${String(transfer.id).slice(0, 17)}`;
}

async function handleMaterialTransferToProduction(event) {
  console.log('\n  -> Material Transfer to Production (SDK)');

  if (!SDK_API_KEY) {
    throw new Error('Missing SAGE_SDK_API_KEY or HYPER_SAGE_API_KEY for protected Sage SDK API');
  }

  const transferId = event.reference_id;
  const { data: transfer, error } = await supabase
    .from('material_transfers')
    .select(`
      id,
      raw_material_id,
      transfer_number,
      quantity,
      unit,
      transfer_date,
      purpose,
      notes,
      status,
      production_order_id,
      raw_materials (
        id,
        name,
        code,
        sage_code
      )
    `)
    .eq('id', transferId)
    .single();

  if (error || !transfer) {
    throw new Error(`Material transfer not found: ${transferId} - ${error?.message || 'no row returned'}`);
  }

  if (transfer.status !== 'received') {
    throw new Error(`Material transfer ${transfer.transfer_number || transfer.id} is not received; current status is ${transfer.status}`);
  }

  const sageCode = transfer.raw_materials?.sage_code || transfer.raw_materials?.code;
  const quantity = Number(transfer.quantity || 0);

  if (!sageCode) {
    throw new Error(`No Sage code for material ${transfer.raw_materials?.name || transfer.raw_materials?.id || transfer.raw_material_id}`);
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`Invalid material transfer quantity: ${transfer.quantity}`);
  }

  const body = {
    itemCode: sageCode,
    fromWarehouse: 'RM',
    toWarehouse: 'PD',
    quantity,
    reference: buildReference(transfer),
    reference2: `MES material transfer ${transfer.transfer_number || transfer.id}`.substring(0, 50),
    confirmPost: true,
  };

  console.log(`  Material: ${sageCode} - ${quantity}${transfer.unit || 'kg'} RM -> PD`);
  console.log(`  Reference: ${body.reference}`);

  if (DRY_RUN) {
    console.log(`[DRY RUN] Would POST ${SDK_BASE_URL}/api/v1/warehouse-transfers/post`);
    console.log(`[DRY RUN] Payload: ${JSON.stringify({ ...body, confirmPost: false })}`);
    return {
      dryRun: true,
      message: `DRY RUN: ${body.reference} would post ${sageCode} ${quantity}${transfer.unit || 'kg'} RM -> PD through Sage SDK`,
      details: { sdkTransfer: { ...body, confirmPost: false } },
    };
  }

  const result = await postJson(
    `${SDK_BASE_URL}/api/v1/warehouse-transfers/post`,
    SDK_API_KEY,
    body
  );

  console.log(`  Sage SDK response: ${result.status || 'ok'} - ${result.message || 'posted'}`);
  return {
    message: `Posted to Sage: ${body.reference} moved ${sageCode} ${quantity}${transfer.unit || 'kg'} from RM to PD`,
    sage_response: result,
    details: {
      sdkTransfer: body,
      sageStatus: result.status || 'posted',
      sageMessage: result.message || null,
    },
  };
}

module.exports = { handleMaterialTransferToProduction };

if (require.main === module) {
  const transferId = process.argv[2];
  if (!transferId) {
    console.error('ERROR: Usage: node materialTransferSdkAuto.js <material_transfer_id>');
    process.exit(1);
  }

  handleMaterialTransferToProduction({ reference_id: transferId })
    .then(() => process.exit(0))
    .catch((err) => { console.error('ERROR:', err.message); process.exit(1); });
}
