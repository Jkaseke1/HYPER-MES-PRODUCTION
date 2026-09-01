// Posts completed production batches as Sage MFMF finished-goods receipts through the SDK API.

const http = require('http');
const https = require('https');
const { supabase, DRY_RUN } = require('./lib/db');
const { getSageProductUnitSettings, toSageUnits } = require('./lib/sageProductUnits');

const SDK_BASE_URL = (process.env.SAGE_SDK_API_BASE_URL || 'http://127.0.0.1:5088').replace(/\/+$/, '');
const SDK_API_KEY = process.env.SAGE_SDK_API_KEY || process.env.HYPER_SAGE_API_KEY;
// Production completion is a manufacture receipt into Production. A clerk moves
// finished goods to Dispatch later through the separate PD -> DEB workflow.
const FINISHED_GOODS_WAREHOUSE = (process.env.SAGE_FINISHED_GOODS_WAREHOUSE_CODE || 'PD').trim().toUpperCase();
const PRODUCTION_WAREHOUSE_ID = Number(process.env.SAGE_PRODUCTION_WAREHOUSE_ID || 19);
const RAW_MATERIAL_WAREHOUSE_ID = Number(process.env.SAGE_RAW_MATERIAL_WAREHOUSE_ID || 18);

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
        const error = new Error(`Sage finished-goods API failed: ${parsed.message || parsed.Message || `HTTP ${response.statusCode}`}`);
        error.statusCode = response.statusCode;
        error.response = parsed;
        reject(error);
      });
    });
    request.on('error', (error) => reject(new Error(`Sage finished-goods API connection failed: ${error.message}`)));
    request.write(payload);
    request.end();
  });
}

function localDateValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function handleBatchComplete(syncEvent) {
  console.log('\n  -> Batch Complete / Finished Goods Receipt (SDK)');
  if (!SDK_API_KEY) throw new Error('Missing SAGE_SDK_API_KEY or HYPER_SAGE_API_KEY for protected Sage SDK API');

  let { data: order, error } = await supabase
    .from('production_orders')
    .select('id, batch_number, actual_qty, rejected_qty, total_cost, cost_per_unit, sage_mfp_reference, formulations(id, name, sage_code)')
    .eq('id', syncEvent.reference_id)
    .single();
  if (error && /sage_mfp_reference/i.test(error.message || '')) {
    // Keep live posting compatible until the MES reference-column migration is applied.
    ({ data: order, error } = await supabase
      .from('production_orders')
      .select('id, batch_number, actual_qty, rejected_qty, total_cost, cost_per_unit, formulations(id, name, sage_code)')
      .eq('id', syncEvent.reference_id)
      .single());
  }
  if (error || !order) throw new Error(`Production order not found: ${syncEvent.reference_id}`);

  const itemCode = (order.formulations?.sage_code || '').trim();
  const quantity = Number(order.actual_qty || 0) - Number(order.rejected_qty || 0);
  const unitCost = Number(order.cost_per_unit || 0);
  if (!itemCode) throw new Error(`No Sage code for finished good ${order.formulations?.name || order.id}`);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Invalid finished-goods quantity: ${quantity}`);
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error(`Invalid finished-goods unit cost: ${unitCost}`);

  const { data: issuedMaterials, error: issuedMaterialsError } = await supabase
    .from('production_order_materials')
    .select('actual_qty, unit_cost, raw_materials(name, sage_code, code)')
    .eq('production_order_id', order.id)
    .eq('issued', true);
  if (issuedMaterialsError) throw new Error(`Could not load issued production materials: ${issuedMaterialsError.message}`);
  if (!issuedMaterials?.length) throw new Error(`No issued materials available for Sage manufacturing documentation on ${order.batch_number}.`);

  const { kgPerSageUnit, postingCostMode } = await getSageProductUnitSettings(
    supabase,
    order.formulations?.id,
    itemCode
  );
  const sageUnits = toSageUnits(quantity, kgPerSageUnit, itemCode);

  const body = {
    reference: `WO-${order.batch_number}`.substring(0, 50),
    reference2: `MES production order ${order.id}`.substring(0, 50),
    itemCode,
    description: `${order.formulations?.name || itemCode} manufacture`.substring(0, 255),
    warehouse: FINISHED_GOODS_WAREHOUSE,
    transactionCode: 'MFMF',
    quantity: sageUnits,
    unitCost,
    receiptDate: localDateValue(),
    confirmPost: true,
  };
  const manufacturingProcessBody = {
    // Sage allocates the next MFP###### reference for a new batch. Retain it
    // in MES so retries use the same Sage manufacturing-process document.
    processReference: (order.sage_mfp_reference || order.batch_number || '').substring(0, 50),
    externalReference: order.batch_number.substring(0, 50),
    finishedGoodCode: itemCode,
    // Sage manufacturing documents use the finished-good stock unit. MES keeps
    // the operational quantity in kilograms, so 1,000 kg of a 50 kg SKU is 20.
    quantity: sageUnits,
    warehouseId: PRODUCTION_WAREHOUSE_ID,
    unitCost,
    transactionDate: body.receiptDate,
    description: `${order.formulations?.name || itemCode} manufacture (${quantity}kg / ${sageUnits} Sage unit(s))`.substring(0, 255),
    components: issuedMaterials.map((material) => {
      const rawMaterial = Array.isArray(material.raw_materials) ? material.raw_materials[0] : material.raw_materials;
      const sageCode = (rawMaterial?.sage_code || rawMaterial?.code || '').trim();
      const componentQuantity = Number(material.actual_qty || 0);
      if (!sageCode || !Number.isFinite(componentQuantity) || componentQuantity <= 0) {
        throw new Error(`Invalid Sage manufacturing component for ${rawMaterial?.name || 'an issued material'}.`);
      }
      return {
        sageCode,
        quantity: componentQuantity,
        unitCost: Number(material.unit_cost || 0),
        warehouseId: RAW_MATERIAL_WAREHOUSE_ID,
        description: rawMaterial?.name || sageCode,
      };
    }),
    confirmPost: true,
  };

  console.log(`  Batch: ${order.batch_number}`);
  console.log(`  Product: ${itemCode} - ${quantity}kg (${sageUnits} Sage unit(s) x ${kgPerSageUnit}kg) to ${FINISHED_GOODS_WAREHOUSE}`);
  console.log(`  MES cost: ${unitCost} per kg; Sage valuation mode: ${postingCostMode}; reference ${body.reference}`);

  if (DRY_RUN) {
    return { dryRun: true, message: `DRY RUN: ${body.reference} would post finished goods through Sage SDK`, details: { sdkFinishedGoodsReceipt: { ...body, confirmPost: false } } };
  }

  const result = await postJson(`${SDK_BASE_URL}/api/v1/finished-goods-receipts/post`, body);
  console.log(`  Sage SDK response: ${result.status || 'ok'} - ${result.message || 'posted'}`);
  let manufacturingProcessResult = null;
  try {
    manufacturingProcessResult = await postJson(`${SDK_BASE_URL}/api/v1/manufacturing-processes/post`, manufacturingProcessBody);
    const processReference = (manufacturingProcessResult.processReference || '').trim();
    if (processReference && processReference !== order.sage_mfp_reference && Object.prototype.hasOwnProperty.call(order, 'sage_mfp_reference')) {
      const { error: mfpReferenceError } = await supabase
        .from('production_orders')
        .update({ sage_mfp_reference: processReference })
        .eq('id', order.id);
      if (mfpReferenceError) throw new Error(`Sage manufacturing process ${processReference} was posted, but MES could not retain its reference: ${mfpReferenceError.message}`);
    }
    console.log(`  Sage manufacturing process: ${manufacturingProcessResult.status || 'ok'} - ${manufacturingProcessResult.message || 'recorded'}`);
  } catch (manufacturingProcessError) {
    // The inventory receipt is already committed. A missing Sage BOM must not
    // turn that successful stock posting into a duplicate-retry risk.
    manufacturingProcessResult = {
      status: 'warning',
      message: manufacturingProcessError.message,
      response: manufacturingProcessError.response || null,
    };
    console.warn(`  Sage manufacturing-process log skipped: ${manufacturingProcessError.message}`);
  }
  return {
    message: `Posted ${quantity}kg (${sageUnits} Sage unit(s)) of ${itemCode} to Sage finished goods for ${order.batch_number}`,
    sage_response: result,
    details: { sdkFinishedGoodsReceipt: body, manufacturingProcess: manufacturingProcessResult, quantityKg: quantity, kgPerSageUnit, sageStatus: result.status || 'posted', sageMessage: result.message || null },
  };
}

module.exports = { handleBatchComplete };
