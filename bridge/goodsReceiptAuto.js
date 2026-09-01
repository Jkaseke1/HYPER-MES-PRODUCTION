// goodsReceiptAuto.js - Event 1: GRN Confirmation Handler
// Posts approved MES GRNs through the protected local Sage API so Sage owns the GRV number.

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

          const message = parsed?.exceptionMessage || parsed?.ExceptionMessage || parsed?.Message || parsed?.message || responseBody || `HTTP ${res.statusCode}`;
          const error = new Error(`Sage GRV API failed: ${message}`);
          error.statusCode = res.statusCode;
          error.response = parsed;
          reject(error);
        });
      }
    );

    req.on('error', (err) => {
      reject(new Error(`Sage GRV API connection failed: ${err.message}`));
    });

    req.write(payload);
    req.end();
  });
}

function requirePositiveNumber(value, label) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be greater than zero`);
  }
  return parsed;
}

async function handleGoodsReceipt(syncEvent) {
  console.log('\n  -> Event 1: Goods Receipt / GRV (SDK)');

  if (!SDK_API_KEY) {
    throw new Error('Missing SAGE_SDK_API_KEY or HYPER_SAGE_API_KEY for protected Sage SDK API');
  }

  const grnId = syncEvent.reference_id;
  console.log(`  GRN ID: ${grnId}`);

  const { data: grn, error: grnError } = await supabase
    .from('goods_received_notes')
    .select(`
      id,
      grn_number,
      received_date,
      status,
      supplier_id,
      supplier_invoice_no,
      supplier_delivery_note_no,
      supplier_order_no,
      external_reference,
      wb_transaction_no,
      suppliers (
        id,
        name,
        code,
        sage_code
      ),
      warehouses (
        id,
        name,
        code
      )
    `)
    .eq('id', grnId)
    .single();

  if (grnError || !grn) {
    throw new Error(`GRN not found: ${grnId} - ${grnError?.message || 'no row returned'}`);
  }

  if (grn.status !== 'approved') {
    throw new Error(`GRN ${grn.grn_number || grn.id} is not approved; current status is ${grn.status}`);
  }

  const supplierCode = (grn.suppliers?.sage_code || grn.suppliers?.code || '').trim();
  if (!supplierCode) {
    throw new Error(`No Sage supplier code for ${grn.suppliers?.name || grn.supplier_id}`);
  }

  const { data: items, error: itemsError } = await supabase
    .from('grn_items')
    .select(`
      id,
      received_qty,
      unit_cost,
      batch_number,
      raw_material_id,
      raw_materials (
        id,
        name,
        code,
        sage_code
      )
    `)
    .eq('grn_id', grnId);

  if (itemsError) throw new Error(`GRN items query failed: ${itemsError.message}`);
  if (!items || items.length === 0) throw new Error(`No items found for GRN: ${grn.grn_number}`);

  const warehouseCode = (grn.warehouses?.code || 'RM').trim().toUpperCase();
  const lines = items.map((item) => {
    const itemCode = (item.raw_materials?.sage_code || item.raw_materials?.code || '').trim();
    if (!itemCode) {
      throw new Error(`No Sage item code for ${item.raw_materials?.name || item.raw_material_id}`);
    }

    return {
      itemCode,
      description: (item.raw_materials?.name || itemCode).substring(0, 100),
      quantity: requirePositiveNumber(item.received_qty, `Received quantity for ${itemCode}`),
      unitCost: Number(item.unit_cost || 0),
      warehouse: warehouseCode,
      lotNumber: item.batch_number || '',
    };
  });

  const body = {
    reference: grn.grn_number,
    supplierCode,
    supplierName: grn.suppliers?.name || '',
    supplierInvoiceNo: grn.supplier_invoice_no || '',
    supplierDeliveryNoteNo: grn.supplier_delivery_note_no || '',
    supplierOrderNo: grn.supplier_order_no || '',
    externalReference: grn.external_reference || grn.wb_transaction_no || '',
    warehouse: warehouseCode,
    receivedDate: grn.received_date,
    lines,
    confirmPost: true,
  };

  console.log(`  GRN: ${grn.grn_number} - ${grn.suppliers?.name || supplierCode}`);
  console.log(`  Lines: ${lines.length}, warehouse ${warehouseCode}`);

  if (DRY_RUN) {
    console.log(`[DRY RUN] Would POST ${SDK_BASE_URL}/api/v1/goods-receipts/post`);
    console.log(`[DRY RUN] Payload: ${JSON.stringify({ ...body, confirmPost: false })}`);
    return {
      dryRun: true,
      message: `DRY RUN: ${grn.grn_number} would post to Sage GRV through SDK API`,
      details: { sdkGoodsReceipt: { ...body, confirmPost: false } },
    };
  }

  const result = await postJson(
    `${SDK_BASE_URL}/api/v1/goods-receipts/post`,
    SDK_API_KEY,
    body
  );

  const grvNumber = result.grvNumber || result.goodsReceipt?.grvNumber || result.documentNumber;
  console.log(`  Sage standalone GRV response: ${result.status || 'ok'} - ${grvNumber || result.message || 'posted'}`);

  if (grvNumber) {
    const { error: sequenceError } = await supabase.rpc('advance_sage_grv_sequence', {
      p_grv_number: grvNumber,
    });
    if (sequenceError) {
      // Sage has already posted the GRV. Do not turn a successful posting into a retry.
      console.warn(`Sage GRV sequence update skipped: ${sequenceError.message}`);
    }
  }

  return {
    message: grvNumber
      ? `Posted to Sage standalone GRV ${grvNumber} from MES ${grn.grn_number}`
      : `Posted to Sage standalone GRV from MES ${grn.grn_number}`,
    sage_response: result,
    details: {
      sdkGoodsReceipt: body,
      sageStatus: result.status || 'posted',
      sageGrvNumber: grvNumber || null,
      sageMessage: result.message || null,
    },
  };
}

module.exports = { handleGoodsReceipt };

if (require.main === module) {
  const grnId = process.argv[2];
  if (!grnId) {
    console.error('ERROR: Usage: node goodsReceiptAuto.js <goods_received_note_id>');
    process.exit(1);
  }

  handleGoodsReceipt({ reference_id: grnId })
    .then(() => process.exit(0))
    .catch((err) => { console.error('ERROR:', err.message); process.exit(1); });
}
