// goodsIssueAuto.js - Posts approved production-order material issues through the Sage SDK API.

const http = require('http');
const https = require('https');
const { supabase, DRY_RUN } = require('./lib/db');

const DEFAULT_SDK_BASE_URL = 'http://127.0.0.1:5088';
const SDK_BASE_URL = (process.env.SAGE_SDK_API_BASE_URL || DEFAULT_SDK_BASE_URL).replace(/\/+$/, '');
const SDK_API_KEY = process.env.SAGE_SDK_API_KEY || process.env.HYPER_SAGE_API_KEY;
const PRODUCTION_WAREHOUSE = (process.env.SAGE_PRODUCTION_WAREHOUSE_CODE || 'PD').trim().toUpperCase();

function postJson(urlString, apiKey, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = JSON.stringify(body);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-Hyper-Api-Key': apiKey,
      },
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        let parsed = responseBody;
        try { parsed = responseBody ? JSON.parse(responseBody) : {}; } catch (_) { /* Preserve plain text diagnostics. */ }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        const message = parsed?.exceptionMessage || parsed?.Message || parsed?.message || responseBody || `HTTP ${res.statusCode}`;
        const error = new Error(`Sage material-issue API failed: ${message}`);
        error.statusCode = res.statusCode;
        error.response = parsed;
        reject(error);
      });
    });
    req.on('error', (err) => reject(new Error(`Sage material-issue API connection failed: ${err.message}`)));
    req.write(payload);
    req.end();
  });
}

function localDateValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function handleGoodsIssue(syncEvent) {
  console.log('\n  -> Material Issue to Production (SDK)');
  if (!SDK_API_KEY) throw new Error('Missing SAGE_SDK_API_KEY or HYPER_SAGE_API_KEY for protected Sage SDK API');
  if (syncEvent.reference_type && syncEvent.reference_type !== 'production_orders') {
    throw new Error(`Material issue event must reference production_orders, received ${syncEvent.reference_type}`);
  }

  const orderId = syncEvent.reference_id;
  const { data: order, error: orderError } = await supabase
    .from('production_orders')
    .select('id, batch_number, status')
    .eq('id', orderId)
    .single();
  if (orderError || !order) throw new Error(`Production order not found: ${orderId} - ${orderError?.message || 'no row returned'}`);
  if (!['materials_issued', 'in_progress', 'completed'].includes(order.status)) {
    throw new Error(`Production order ${order.batch_number || order.id} is not ready for Sage issue; current status is ${order.status}`);
  }

  const { data: materials, error: materialsError } = await supabase
    .from('production_order_materials')
    .select('id, actual_qty, issued, raw_material_id, raw_materials(id, name, code, sage_code)')
    .eq('production_order_id', orderId)
    .eq('issued', true);
  if (materialsError) throw new Error(`Issued materials query failed: ${materialsError.message}`);
  if (!materials || materials.length === 0) throw new Error(`No issued materials found for production order ${order.batch_number || order.id}`);

  const lines = materials.map((material) => {
    const rawMaterial = Array.isArray(material.raw_materials) ? material.raw_materials[0] : material.raw_materials;
    const itemCode = (rawMaterial?.sage_code || rawMaterial?.code || '').trim();
    const quantity = Number(material.actual_qty || 0);
    if (!itemCode) throw new Error(`No Sage item code for ${rawMaterial?.name || material.raw_material_id}`);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Invalid issued quantity for ${itemCode}: ${material.actual_qty}`);
    return {
      itemCode,
      description: `Issue to ${order.batch_number || order.id}: ${rawMaterial?.name || itemCode}`.substring(0, 255),
      quantity,
    };
  });

  const reference = `WO-${order.batch_number || String(order.id).slice(0, 16)}`.substring(0, 50);
  const body = {
    reference,
    reference2: `MES production order ${order.id}`.substring(0, 50),
    warehouse: PRODUCTION_WAREHOUSE,
    transactionCode: 'MFDR',
    issueDate: localDateValue(),
    lines,
    confirmPost: true,
  };

  console.log(`  Batch: ${order.batch_number || order.id}`);
  console.log(`  Lines: ${lines.length}, warehouse ${PRODUCTION_WAREHOUSE}, reference ${reference}`);

  if (DRY_RUN) {
    console.log(`[DRY RUN] Would POST ${SDK_BASE_URL}/api/v1/material-issues/post`);
    return {
      dryRun: true,
      message: `DRY RUN: ${reference} would issue ${lines.length} material line(s) through Sage SDK`,
      details: { sdkMaterialIssue: { ...body, confirmPost: false } },
    };
  }

  const result = await postJson(`${SDK_BASE_URL}/api/v1/material-issues/post`, SDK_API_KEY, body);
  console.log(`  Sage SDK response: ${result.status || 'ok'} - ${result.message || 'posted'}`);
  return {
    message: `Posted ${lines.length} material issue line(s) to Sage from production order ${order.batch_number || order.id}`,
    sage_response: result,
    details: {
      sdkMaterialIssue: body,
      sageStatus: result.status || 'posted',
      sageMessage: result.message || null,
    },
  };
}

module.exports = { handleGoodsIssue };
