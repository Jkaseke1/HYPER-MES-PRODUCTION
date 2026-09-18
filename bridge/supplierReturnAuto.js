// supplierReturnAuto.js - Posts an approved PlantControl RTS through the Sage SDK.

const { supabase, DRY_RUN } = require('./lib/db');

const SDK_BASE_URL = (process.env.SAGE_SDK_API_BASE_URL || 'http://127.0.0.1:5088').replace(/\/+$/, '');
const SDK_API_KEY = process.env.SAGE_SDK_API_KEY || process.env.HYPER_SAGE_API_KEY;

async function postJson(path, body) {
  const response = await fetch(`${SDK_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hyper-Api-Key': SDK_API_KEY },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.exceptionMessage || result.message || `HTTP ${response.status}`);
    error.statusCode = response.status;
    error.response = result;
    throw error;
  }
  return result;
}

async function handleSupplierReturn(syncEvent) {
  const { data: request, error } = await supabase
    .from('supplier_return_requests')
    .select(`id, reason, status, original_grn_id, original_grn:goods_received_notes!original_grn_id(
      grn_number, received_date, suppliers(name, code, sage_code), warehouses(code)
    ), items:supplier_return_items(quantity, unit_cost, raw_materials(code, sage_code, name))`)
    .eq('id', syncEvent.reference_id)
    .single();

  if (error || !request) throw new Error(`Supplier return not found: ${error?.message || syncEvent.reference_id}`);
  if (request.status !== 'approved') throw new Error(`Supplier return is not approved; current status is ${request.status}`);
  if (!SDK_API_KEY) throw new Error('Missing SAGE_SDK_API_KEY or HYPER_SAGE_API_KEY');

  const original = request.original_grn;
  const body = {
    reference: `RTS-${request.id.slice(0, 8).toUpperCase()}`,
    originalGrvNumber: original.grn_number,
    supplierCode: original.suppliers?.sage_code || original.suppliers?.code || '',
    supplierName: original.suppliers?.name || '',
    returnDate: original.received_date,
    reason: request.reason,
    lines: (request.items || []).map((item) => ({
      itemCode: item.raw_materials?.sage_code || item.raw_materials?.code || '',
      quantity: Number(item.quantity),
      unitCost: Number(item.unit_cost || 0),
      warehouse: original.warehouses?.code || 'RM',
    })),
    confirmPost: true,
  };

  if (!body.supplierCode) throw new Error('The original GRN supplier has no Sage code.');
  if (body.lines.some((line) => !line.itemCode)) throw new Error('Every RTS line requires a Sage item code.');

  if (DRY_RUN) return { message: `DRY RUN: RTS for ${original.grn_number} would post to Sage`, details: { sdkSupplierReturn: { ...body, confirmPost: false } } };

  const result = await postJson('/api/v1/supplier-returns/post', body);
  const rtsNumber = result.rtsNumber || result.documentNumber || null;
  await supabase.from('supplier_return_requests').update({
    status: 'posted', sage_rts_number: rtsNumber, sage_response: result, updated_at: new Date().toISOString(),
  }).eq('id', request.id).eq('status', 'approved');

  return {
    message: rtsNumber ? `Posted Sage RTS ${rtsNumber} for ${original.grn_number}` : `Posted Sage RTS for ${original.grn_number}`,
    sage_response: result,
    details: { sdkSupplierReturn: body, sageRtsNumber: rtsNumber },
  };
}

module.exports = { handleSupplierReturn };
