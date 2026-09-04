// bridgeWorker.js - Main bridge worker that polls sync_log and processes events
// Coordinates all auto event handlers and runs continuously
// Uses direct MSSQL for legacy handlers and the validated Sage SDK API for warehouse transfers.

const { supabase, DRY_RUN } = require('./lib/db');
const { handleGoodsReceipt }  = require('./goodsReceiptAuto');
const { handleGoodsIssue }    = require('./goodsIssueAuto');
const { handleBatchComplete } = require('./batchCompleteAuto');
const { handleDispatch }      = require('./dispatchAuto');
const { handleMaterialTransferToProduction } = require('./materialTransferSdkAuto');
const { handleFinishedGoodsTransfer } = require('./finishedGoodsTransferSdkAuto');
const { handleRmCostUpdated } = require('./rmCostUpdatedAuto');
const { syncSageStock, syncFinishedGoodsStock } = require('./sageStockSync');

const DEFAULT_POLL_INTERVAL_MS = 5000;
const MINIMUM_POLL_INTERVAL_MS = 2000;
const configuredPollInterval = Number(process.env.BRIDGE_POLL_INTERVAL_MS);
const POLL_INTERVAL_MS = Number.isFinite(configuredPollInterval)
  ? Math.max(configuredPollInterval, MINIMUM_POLL_INTERVAL_MS)
  : DEFAULT_POLL_INTERVAL_MS;
const configuredStockSyncInterval = Number(process.env.SAGE_STOCK_SYNC_INTERVAL_MS);
const STOCK_SYNC_INTERVAL_MS = Number.isFinite(configuredStockSyncInterval)
  ? Math.max(configuredStockSyncInterval, 10 * 1000)
  : 60 * 1000;
const ALLOWED_EVENT_TYPES = new Set(
  (process.env.BRIDGE_ALLOWED_EVENT_TYPES || '')
    .split(',')
    .map((eventType) => eventType.trim())
    .filter(Boolean),
);
const STOCK_SYNC_ENABLED = process.env.SAGE_STOCK_SYNC_ENABLED === 'true';
const ENFORCE_GRN_ONLY = process.env.BRIDGE_ENFORCE_GRN_ONLY === 'true';
let stockSyncQueue = Promise.resolve();
let eventProcessingInProgress = false;

async function verifySdkConnection() {
  const baseUrl = (process.env.SAGE_SDK_API_BASE_URL || 'http://127.0.0.1:5088').replace(/\/+$/, '');
  const apiKey = process.env.SAGE_SDK_API_KEY || process.env.HYPER_SAGE_API_KEY;
  if (!apiKey) throw new Error('Missing SAGE_SDK_API_KEY or HYPER_SAGE_API_KEY');

  const response = await fetch(`${baseUrl}/api/v1/sdk/connection`, {
    headers: { 'X-Hyper-Api-Key': apiKey },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `Sage SDK connection check failed: HTTP ${response.status}`);
  console.log(`Sage SDK connection: ${body.sdkConnection || 'verified'}`);
}

async function queueSageStockSync(itemCodes, reason, options = {}) {
  const run = stockSyncQueue.catch(() => undefined).then(async () => {
    const result = await syncSageStock(itemCodes, options);
    console.log(`  Sage stock sync (${reason}): ${result.synced} warehouse balance(s) refreshed for ${result.materialCount} material(s)`);
    if (result.failures.length) console.warn(`  Sage stock sync warnings: ${result.failures.slice(0, 3).join('; ')}`);
    return result;
  });
  stockSyncQueue = run.catch(() => undefined);
  return run;
}

async function refreshSageStock(itemCodes, reason) {
  try {
    return await queueSageStockSync(itemCodes, reason);
  } catch (error) {
    console.error(`  Sage stock sync failed (${reason}): ${error.message}`);
    return { materialCount: 0, synced: 0, failures: [error.message] };
  }
}

async function createStockTakeSageSnapshot(event) {
  const stockTakeId = event.reference_id;
  const mandatoryItemIds = new Set((event.details?.mandatoryItemIds || []).filter(Boolean));

  if (!stockTakeId) throw new Error('Stock take snapshot event is missing its stock take reference.');

  try {
    await supabase
      .from('stock_takes')
      .update({ baseline_sync_status: 'SYNCING', baseline_sync_message: 'Reading live RM stock from Sage SDK.', updated_at: new Date().toISOString() })
      .eq('id', stockTakeId);

    // A stock take requires every active RM item at one point in time. Do not
    // use the rolling cache batch that supports normal operational screens.
    const result = await queueSageStockSync(undefined, 'stock take Sage snapshot', { fullSync: true, warehouseCodes: ['RM'] });
    if (result.failures.length) {
      throw new Error(`Sage snapshot incomplete: ${result.failures.slice(0, 5).join('; ')}`);
    }

    const [{ data: materials, error: materialsError }, { data: formulations, error: formulationsError }, { data: balances, error: balancesError }, { data: existingLines, error: linesError }] = await Promise.all([
      supabase.from('raw_materials').select('id, code, sage_code, unit').eq('is_active', true).order('name'),
      supabase.from('formulations').select('sage_code').eq('status', 'active'),
      supabase.from('sage_stock_balances').select('raw_material_id, sage_code, quantity, last_synced_at').eq('warehouse_id', 18),
      supabase.from('stock_take_lines').select('id').eq('stock_take_id', stockTakeId).limit(1),
    ]);
    if (materialsError) throw new Error(`Could not read stock-take materials: ${materialsError.message}`);
    if (formulationsError) throw new Error(`Could not identify finished-good materials: ${formulationsError.message}`);
    if (balancesError) throw new Error(`Could not read the Sage stock snapshot: ${balancesError.message}`);
    if (linesError) throw new Error(`Could not verify stock-take lines: ${linesError.message}`);
    if (existingLines?.length) throw new Error('Stock take already has count lines and cannot be replaced.');

    const finishedGoodCodes = new Set((formulations || []).map((formulation) => String(formulation.sage_code || '').trim().toUpperCase()));
    const rawMaterials = (materials || []).filter((material) => {
      const sageCode = String(material.sage_code || material.code || '').trim().toUpperCase();
      return sageCode && !finishedGoodCodes.has(sageCode);
    });
    const balancesByMaterial = new Map((balances || []).filter((balance) => balance.raw_material_id).map((balance) => [balance.raw_material_id, Number(balance.quantity || 0)]));
    const unmatchedMaterials = rawMaterials.filter((material) => !balancesByMaterial.has(material.id));
    if (unmatchedMaterials.length) {
      throw new Error(`Sage did not return RM balances for ${unmatchedMaterials.length} material(s): ${unmatchedMaterials.slice(0, 5).map((material) => material.sage_code || material.code).join(', ')}`);
    }

    const snapshotAt = new Date().toISOString();
    const lines = rawMaterials.map((material) => ({
      stock_take_id: stockTakeId,
      raw_material_id: material.id,
      system_qty: balancesByMaterial.get(material.id) || 0,
      unit: material.unit || 'kg',
      is_mandatory: mandatoryItemIds.has(material.id),
    }));
    const { error: insertError } = await supabase.from('stock_take_lines').insert(lines);
    if (insertError) throw new Error(`Could not create Sage stock-take lines: ${insertError.message}`);

    const { error: takeUpdateError } = await supabase
      .from('stock_takes')
      .update({
        baseline_source: 'sage_sdk',
        baseline_snapshot_at: snapshotAt,
        baseline_sync_status: 'READY',
        baseline_sync_message: `Live Sage RM snapshot loaded: ${lines.length} material(s).`,
        updated_at: snapshotAt,
      })
      .eq('id', stockTakeId);
    if (takeUpdateError) throw new Error(`Could not mark the Sage snapshot ready: ${takeUpdateError.message}`);

    await supabase.from('stock_take_audit_log').insert({
      stock_take_id: stockTakeId,
      action: 'sage_sdk_snapshot_created',
      changed_by: event.details?.requestedBy || null,
      notes: `Live Sage SDK snapshot captured for RM warehouse: ${lines.length} material(s) at ${snapshotAt}.`,
    });

    return {
      message: `Live Sage RM snapshot complete: ${lines.length} material(s).`,
      details: { materialCount: lines.length, snapshotAt, warehouse: 'RM' },
    };
  } catch (error) {
    await supabase
      .from('stock_takes')
      .update({ baseline_sync_status: 'FAILED', baseline_sync_message: error.message, updated_at: new Date().toISOString() })
      .eq('id', stockTakeId);
    throw error;
  }
}

async function refreshFinishedGoodsStock(itemCodes, reason, warehouseCodes) {
  try {
    const result = await syncFinishedGoodsStock(itemCodes, warehouseCodes);
    console.log(`  Sage finished-goods sync (${reason}): ${result.synced} balance(s) refreshed for ${result.formulationCount} formulation(s)`);
    if (result.failures.length) console.warn(`  Sage finished-goods sync warnings: ${result.failures.slice(0, 3).join('; ')}`);
  } catch (error) {
    console.error(`  Sage finished-goods sync failed (${reason}): ${error.message}`);
  }
}

function postedStockCodes(eventType, details) {
  if (eventType === 'material_transfer_to_production') return [details?.sdkTransfer?.itemCode].filter(Boolean);
  if (eventType === 'materials_issued') return (details?.sdkMaterialIssue?.lines || []).map((line) => line.itemCode).filter(Boolean);
  if (eventType === 'grn_confirmed') return (details?.sdkGoodsReceipt?.lines || []).map((line) => line.itemCode).filter(Boolean);
  return [];
}

async function processPendingEvents() {
  // Do not let a timer tick overlap a slow Sage post; the atomic claim remains
  // the safeguard when another worker instance is ever started accidentally.
  if (eventProcessingInProgress) return;
  eventProcessingInProgress = true;

  try {
  let pendingQuery = supabase
    .from('sync_log')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(100);

  if (ALLOWED_EVENT_TYPES.size > 0) {
    pendingQuery = pendingQuery.in('event_type', [...ALLOWED_EVENT_TYPES]);
  }

  const { data: pending, error } = await pendingQuery;

  if (error) {
    console.error('❌ Failed to read sync_log:', error.message);
    return;
  }

  if (!pending || pending.length === 0) return;

  console.log(`\n[${new Date().toISOString()}] Found ${pending.length} pending event(s)`);

  if (DRY_RUN) {
    for (const event of pending) {
      console.log(`  [DRY RUN] ${event.event_type} - ${event.reference_type} - ${event.reference_id}`);
    }
    console.log('  [DRY RUN] No events were claimed or changed.');
    return;
  }

  // Give users a live FIFO position while another Sage transaction is being
  // posted. The first row is claimed immediately; every later row remains
  // pending and will be picked up as soon as its predecessor finishes.
  const queuedAt = new Date().toISOString();
  await Promise.all(pending.slice(1).map((event, index) =>
    supabase
      .from('sync_log')
      .update({
        message: `Queued for Sage (position ${index + 2} of ${pending.length})`,
        updated_at: queuedAt,
      })
      .eq('id', event.id)
      .eq('status', 'pending')
  ));

  for (const event of pending) {
    // Claim the event atomically. A second bridge instance may have fetched the
    // same pending row, but only one instance is allowed to post it to Sage.
    const { data: claimed, error: claimError } = await supabase
      .from('sync_log')
      .update({
        status: 'processing',
        message: event.event_type === 'grn_confirmed'
          ? 'Validating GRN for Sage'
          : 'Validating Sage transaction',
        updated_at: new Date().toISOString(),
      })
      .eq('id', event.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (claimError) {
      console.error(`  ❌ Failed to claim ${event.id}: ${claimError.message}`);
      continue;
    }

    if (!claimed) {
      console.log(`  ⏭️  ${event.event_type} for ${event.reference_id} was claimed by another worker`);
      continue;
    }

    // ── Idempotency check ─────────────────────────────────────────────────────
    const { data: alreadyDone } = await supabase
      .from('sync_log')
      .select('id')
      .eq('reference_id', event.reference_id)
      .eq('event_type', event.event_type)
      .eq('status', 'success')
      .neq('id', event.id)
      .limit(1);

    if (alreadyDone && alreadyDone.length > 0) {
      console.log(`  ⚠️  Duplicate: ${event.event_type} for ${event.reference_id} — already processed, skipping`);
      await supabase
        .from('sync_log')
        .update({ status: 'success', message: 'Duplicate — already processed successfully', updated_at: new Date().toISOString() })
        .eq('id', event.id);
      continue;
    }
    // ── End idempotency check ─────────────────────────────────────────────────

    console.log(`\nProcessing: ${event.event_type} — ${event.reference_type} — ${event.reference_id}`);

    try {
      let handlerResult = null;

      if (event.event_type === 'grn_confirmed') {
        await supabase
          .from('sync_log')
          .update({ message: 'Posting GRV to Sage', updated_at: new Date().toISOString() })
          .eq('id', event.id)
          .eq('status', 'processing');
      }

      if (event.event_type === 'stock_take_sage_snapshot') {
        await supabase
          .from('sync_log')
          .update({ message: 'Reading live RM stock from Sage SDK', updated_at: new Date().toISOString() })
          .eq('id', event.id)
          .eq('status', 'processing');
      }

      switch (event.event_type) {
        case 'grn_confirmed':
          handlerResult = await handleGoodsReceipt(event);
          break;
        case 'materials_issued':
          handlerResult = await handleGoodsIssue(event);
          break;
        case 'production_completed':
          handlerResult = await handleBatchComplete(event);
          break;
        case 'dispatch_delivered':
          handlerResult = await handleDispatch(event);
          break;
        case 'material_transfer_to_production':
          handlerResult = await handleMaterialTransferToProduction(event);
          break;
        case 'finished_goods_transfer_to_dispatch':
          handlerResult = await handleFinishedGoodsTransfer(event);
          break;
        case 'rm_cost_updated':
          handlerResult = await handleRmCostUpdated(event);
          break;
        case 'stock_take_sage_snapshot':
          handlerResult = await createStockTakeSageSnapshot(event);
          break;
        default:
          console.log(`  ⚠️  Unknown event type: ${event.event_type} — skipping`);
          await supabase
            .from('sync_log')
            .update({ status: 'success', message: `Unknown event type skipped: ${event.event_type}`, updated_at: new Date().toISOString() })
            .eq('id', event.id);
          continue;
      }

      const successUpdate = {
        status: 'success',
        updated_at: new Date().toISOString(),
      };

      if (event.retried_at) {
        successUpdate.resolved_at = new Date().toISOString();
      }

      if (handlerResult?.message) successUpdate.message = handlerResult.message;
      if (handlerResult?.sage_response) successUpdate.sage_response = handlerResult.sage_response;
      if (handlerResult?.details) successUpdate.details = handlerResult.details;

      // A transaction is only ready for MES users once the related Sage stock
      // balance is refreshed. Keep the visible status as "Posting to Sage"
      // until that reconciliation finishes, so production never sees a stale
      // balance immediately after a successful transfer.
      const itemCodes = postedStockCodes(event.event_type, handlerResult?.details);
      if (itemCodes.length) {
        if (event.event_type === 'grn_confirmed') {
          await supabase
            .from('sync_log')
            .update({ message: 'Finalising Sage stock balance', updated_at: new Date().toISOString() })
            .eq('id', event.id)
            .eq('status', 'processing');
        }
        await refreshSageStock([...new Set(itemCodes)], `after ${event.event_type}`);
      }
      if (event.event_type === 'production_completed') {
        const finishedGoodCode = handlerResult?.details?.sdkFinishedGoodsReceipt?.itemCode;
        if (finishedGoodCode) await refreshFinishedGoodsStock([finishedGoodCode], 'after production_completed');
      }
      if (event.event_type === 'finished_goods_transfer_to_dispatch') {
        const finishedGoodCode = handlerResult?.details?.sdkFinishedGoodsTransfer?.itemCode;
        if (finishedGoodCode) await refreshFinishedGoodsStock([finishedGoodCode], 'after finished_goods_transfer_to_dispatch', ['PD', 'DEB']);
      }
      if (event.event_type === 'dispatch_delivered') {
        const transfer = handlerResult?.details?.sdkBranchDispatchTransfer;
        const itemCodes = transfer?.items?.map((item) => item.itemCode).filter(Boolean) || [];
        if (itemCodes.length) await refreshFinishedGoodsStock(itemCodes, 'after dispatch_delivered', [transfer.sourceWarehouse, transfer.destinationWarehouse]);
      }

      const { error: syncSuccessError } = await supabase
        .from('sync_log')
        .update(successUpdate)
        .eq('id', event.id);
      if (syncSuccessError) throw new Error(`Sage posted successfully, but MES could not record the Sage result: ${syncSuccessError.message}`);

      if (event.event_type === 'production_completed') {
        const { error: completionError } = await supabase
          .from('production_orders')
          .update({ status: 'completed', actual_end: new Date().toISOString() })
          .eq('id', event.reference_id)
          .eq('status', 'in_progress');
        if (completionError) throw new Error(`Sage posted finished goods, but MES could not finalize the batch: ${completionError.message}`);
      }

      console.log(`  ✅ ${event.event_type} processed successfully`);

    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);

      if (event.event_type === 'finished_goods_transfer_to_dispatch') {
        const { error: transferUpdateError } = await supabase
          .from('finished_goods_transfers')
          .update({
            status: 'failed',
            sage_response: {
              status: 'failed',
              message: err.message,
              statusCode: err.statusCode || null,
              response: err.response || null,
              failed_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', event.reference_id)
          .eq('status', 'pending');
        if (transferUpdateError) console.error(`  Failed to mark finished-goods transfer as failed in MES: ${transferUpdateError.message}`);
      }

      await supabase
        .from('sync_log')
        .update({
          status:        'failed',
          message:       err.message,
          error_details: {
            message: err.message,
            stack: err.stack,
            statusCode: err.statusCode || null,
            response: err.response || null,
          },
          last_failed_at: new Date().toISOString(),
          last_failure_message: err.message,
          last_failure_details: {
            message: err.message,
            statusCode: err.statusCode || null,
            response: err.response || null,
          },
          resolved_at: null,
          retry_count:   (event.retry_count || 0) + 1,
          next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          updated_at:    new Date().toISOString(),
        })
        .eq('id', event.id);
    }
  }
  } finally {
    eventProcessingInProgress = false;
  }
}

async function startWorker() {
  if (ENFORCE_GRN_ONLY && (ALLOWED_EVENT_TYPES.size !== 1 || !ALLOWED_EVENT_TYPES.has('grn_confirmed'))) {
    throw new Error('Production GRN scope lock requires BRIDGE_ALLOWED_EVENT_TYPES=grn_confirmed');
  }

  console.log('==============================================');
  console.log(' HYPER MES — Sage Pastel Bridge Worker');
  console.log(` Mode: ${DRY_RUN ? 'DRY RUN (safe — no Sage writes)' : 'LIVE'}`);
  console.log(` Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
  console.log(` Event scope: ${ALLOWED_EVENT_TYPES.size > 0 ? [...ALLOWED_EVENT_TYPES].join(', ') : 'all supported Sage events'}`);
  console.log(` Sage stock sync: ${STOCK_SYNC_ENABLED ? 'ENABLED' : 'DISABLED'}`);
  console.log('==============================================\n');
  console.log('Watching sync_log for pending events...');
  console.log('Idempotency check: ENABLED — no duplicate processing\n');

  // Initialise the Evolution SDK before claiming any event. This prevents a
  // fresh API process from accepting a bridge event before Sage is ready.
  try {
    await verifySdkConnection();
  } catch (error) {
    console.error(`Sage SDK startup check failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  // Opening balances remain authoritative until live Sage reconciliation is approved.
  if (STOCK_SYNC_ENABLED && !DRY_RUN) {
    void refreshSageStock(undefined, 'startup reconciliation batch');
  }

  await processPendingEvents();
  setInterval(processPendingEvents, POLL_INTERVAL_MS);
  if (STOCK_SYNC_ENABLED && !DRY_RUN) {
    setInterval(() => { refreshSageStock(undefined, 'scheduled refresh'); }, STOCK_SYNC_INTERVAL_MS);
  }
}

process.on('SIGINT',  () => { console.log('\n📡 Shutting down...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n📡 Shutting down...'); process.exit(0); });

startWorker();
