// materialTransferSdkAuto.js - Posts approved RM -> Production transfers via Sage SDK API
// Reads material_transfers by reference_id from sync_log and avoids direct Sage SQL writes.

const { sdkJson } = require('./lib/sdkHttp');
const { supabase, DRY_RUN } = require('./lib/db');

const DEFAULT_SDK_BASE_URL = 'http://127.0.0.1:5088';
const SDK_BASE_URL = (process.env.SAGE_SDK_API_BASE_URL || DEFAULT_SDK_BASE_URL).replace(/\/+$/, '');
const SDK_API_KEY = process.env.SAGE_SDK_API_KEY || process.env.HYPER_SAGE_API_KEY;

function postJson(urlString, apiKey, body) {
  return sdkJson(urlString, { method: 'POST', apiKey, body, timeoutMs: 120000 });
}

function buildReference(transfer) {
  const istReference = (transfer.purpose || '').trim().match(/^HFIST\d+$/i)?.[0];
  if (istReference) return istReference.toUpperCase();
  const transferNumber = (transfer.transfer_number || '').trim();
  if (transferNumber) return transferNumber;
  return `MT-${String(transfer.id).slice(0, 17)}`;
}

async function handleMaterialTransferToProduction(event) {
  if (event.error_details?.postingOutcomeUnknown) {
    const error = new Error('Previous Sage posting outcome is unresolved. Verify Sage before retrying this transfer.');
    error.postingOutcomeUnknown = true;
    throw error;
  }
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
      transfer_batch_key,
      reversed_by,
      reversed_at,
      production_approved_by,
      approved_by,
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
  if (transfer.reversed_by || transfer.reversed_at || transfer.status === 'rejected') {
    throw new Error(`Material transfer ${transfer.transfer_number || transfer.id} was reversed and cannot be posted to Sage`);
  }

  if (transfer.transfer_batch_key) {
    const { data: duplicateLines, error: duplicateError } = await supabase
      .from('material_transfers')
      .select('id, transfer_number, status')
      .eq('transfer_batch_key', transfer.transfer_batch_key)
      .eq('raw_material_id', transfer.raw_material_id)
      .neq('id', transfer.id)
      .in('status', ['in_buffer', 'approved', 'in_transit', 'received']);
    if (duplicateError) throw new Error(`Could not validate duplicate material lines: ${duplicateError.message}`);
    if (duplicateLines?.length) {
      throw new Error(`Duplicate material line in IST ${transfer.purpose || transfer.transfer_batch_key}; Sage posting blocked`);
    }
  }

  const sageCode = transfer.raw_materials?.sage_code || transfer.raw_materials?.code;
  const quantity = Number(transfer.quantity || 0);
  const transactionDate = String(transfer.transfer_date || '').slice(0, 10);
  const parsedDate = new Date(`${transactionDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate) ||
      Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== transactionDate) {
    throw new Error('RM initiator transfer date is missing or invalid; Sage posting blocked.');
  }

  let plantControlUser = 'PlantControl';
  const plantControlUserId = transfer.production_approved_by || transfer.approved_by;
  if (plantControlUserId) {
    const { data: approver, error: approverError } = await supabase
      .from('profiles')
      .select('full_name,email')
      .eq('id', plantControlUserId)
      .maybeSingle();
    if (approverError) throw new Error(`Approver profile query failed: ${approverError.message}`);
    plantControlUser = (approver?.full_name || approver?.email?.split('@')[0] || 'PlantControl').trim();
  }

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
    transactionDate,
    reference: buildReference(transfer),
    reference2: `MES material transfer ${transfer.transfer_number || transfer.id}`.substring(0, 50),
    userName: plantControlUser.substring(0, 50),
    confirmPost: true,
  };

  console.log(`  Material: ${sageCode} - ${quantity}${transfer.unit || 'kg'} RM -> PD`);
  console.log(`  Reference: ${body.reference}`);
  console.log(`  RM transaction date: ${body.transactionDate}`);

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

  if (result.sagePosting !== 'completed') {
    const error = new Error('Sage did not return a completed posting confirmation. Verify Sage before retrying.');
    error.postingOutcomeUnknown = true;
    throw error;
  }

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
