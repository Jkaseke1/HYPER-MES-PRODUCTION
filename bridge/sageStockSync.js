// Read-only Sage stock cache synchronizer. Sage remains the inventory authority.

const { sdkJson } = require('./lib/sdkHttp');
const { supabase } = require('./lib/db');

const SDK_BASE_URL = (process.env.SAGE_SDK_API_BASE_URL || 'http://127.0.0.1:5088').replace(/\/+$/, '');
const SDK_API_KEY = process.env.SAGE_SDK_API_KEY || process.env.HYPER_SAGE_API_KEY;
const WAREHOUSES = [
  { code: 'RM', id: 18 },
  { code: 'PD', id: 19 },
];
const FINISHED_GOODS_WAREHOUSES = [
  { code: 'PD', id: 19 },
  { code: 'DEB', id: 17 },
  { code: 'DSP', id: 20 }, // retained for historical receipts only
];
const FULL_SYNC_BATCH_SIZE = Math.max(1, Number(process.env.SAGE_STOCK_SYNC_BATCH_SIZE || 50));
let nextFullSyncOffset = 0;

function getJson(urlString) {
  return sdkJson(urlString, { apiKey: SDK_API_KEY, timeoutMs: 15000 });
}

async function loadMaterials(itemCodes, { fullSync = false, warehouseCodes } = {}) {
  let query = supabase
    .from('raw_materials')
    .select('id, code, sage_code')
    .eq('is_active', true)
    .order('id');
  if (!itemCodes?.length && !fullSync) {
    query = query.range(nextFullSyncOffset, nextFullSyncOffset + FULL_SYNC_BATCH_SIZE - 1);
  }
  // Targeted preflights must not be limited to the first API page of the catalogue.
  let data, error;
  if (itemCodes?.length) {
    const codes = [...new Set(itemCodes.map(code => String(code).trim().toUpperCase()))];
    const bySage = await query.in('sage_code', codes);
    const byCode = await supabase.from('raw_materials').select('id, code, sage_code')
      .eq('is_active', true).in('code', codes);
    error = bySage.error || byCode.error;
    data = [...new Map([...(bySage.data || []), ...(byCode.data || [])].map(row => [row.id, row])).values()];
  } else {
    ({ data, error } = await query);
  }
  if (error) throw new Error(`Could not load MES raw materials: ${error.message}`);
  if (!itemCodes?.length && !fullSync) {
    nextFullSyncOffset = (data || []).length < FULL_SYNC_BATCH_SIZE
      ? 0
      : nextFullSyncOffset + FULL_SYNC_BATCH_SIZE;
  }
  const requestedCodes = itemCodes?.length
    ? new Set(itemCodes.map((itemCode) => String(itemCode).trim().toUpperCase()))
    : null;
  const materials = (data || []).filter((material) => {
    const itemCode = (material.sage_code || material.code || '').trim().toUpperCase();
    return itemCode && (!requestedCodes || requestedCodes.has(itemCode));
  });
  if (!materials.length) return materials;

  // RM ingredients may also have formulations (for example Full Fat Soya Meal).
  // An explicit RM-only check must read their Sage RM balance. Keep excluding
  // formulation overlaps from rolling/mixed/PD refreshes to protect FG ownership.
  if (itemCodes?.length && warehouseCodes?.length === 1 && warehouseCodes[0] === 'RM') {
    return materials;
  }

  // Finished goods can exist in the legacy raw_materials catalogue as well as
  // formulations. Their PD/DEB balance belongs to the formulation record; do
  // not overwrite it with a raw-material source during rolling reconciliation.
  const codes = [...new Set(materials.map((material) => (material.sage_code || material.code).trim().toUpperCase()))];
  const { data: formulations, error: formulationError } = await supabase
    .from('formulations')
    .select('sage_code')
    .eq('status', 'active')
    .in('sage_code', codes);
  if (formulationError) throw new Error(`Could not identify finished-good Sage codes: ${formulationError.message}`);

  const finishedGoodCodes = new Set((formulations || []).map((formulation) => (formulation.sage_code || '').trim().toUpperCase()));
  return materials.filter((material) => !finishedGoodCodes.has((material.sage_code || material.code).trim().toUpperCase()));
}

async function syncSageStock(itemCodes, { fullSync = false, warehouseCodes } = {}) {
  if (!SDK_API_KEY) throw new Error('Missing SAGE_SDK_API_KEY or HYPER_SAGE_API_KEY for Sage stock sync');
  const requestedWarehouses = (warehouseCodes || []).map((code) => String(code).trim().toUpperCase()).filter(Boolean);
  const warehouses = requestedWarehouses.length
    ? WAREHOUSES.filter((warehouse) => requestedWarehouses.includes(warehouse.code))
    : WAREHOUSES;
  if (requestedWarehouses.length && warehouses.length !== requestedWarehouses.length) {
    throw new Error(`Unknown Sage warehouse requested: ${requestedWarehouses.filter((code) => !warehouses.some((warehouse) => warehouse.code === code)).join(', ')}`);
  }
  const materials = await loadMaterials(itemCodes, { fullSync, warehouseCodes: warehouses.map(warehouse => warehouse.code) });
  let synced = 0;
  const failures = [];

  for (const material of materials) {
    const itemCode = (material.sage_code || material.code).trim().toUpperCase();
    for (const warehouse of warehouses) {
      try {
        const stock = await getJson(`${SDK_BASE_URL}/api/v1/stock?itemCode=${encodeURIComponent(itemCode)}&warehouse=${encodeURIComponent(warehouse.code)}`);
        const { error } = await supabase.from('sage_stock_balances').upsert({
          raw_material_id: material.id,
          sage_code: itemCode,
          warehouse_id: warehouse.id,
          quantity: validatedStockQuantity(stock.quantity),
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'raw_material_id,warehouse_id' });
        if (error) throw new Error(error.message);
        synced += 1;
      } catch (error) {
        failures.push(`${itemCode}/${warehouse.code}: ${error.message}`);
      }
    }
  }

  return { materialCount: materials.length, warehouseCount: warehouses.length, synced, failures, fullSyncBatch: !itemCodes?.length && !fullSync, fullSync };
}

async function syncFinishedGoodsStock(itemCodes, warehouseCodes) {
  if (!SDK_API_KEY) throw new Error('Missing SAGE_SDK_API_KEY or HYPER_SAGE_API_KEY for Sage stock sync');
  if (!itemCodes?.length) return { formulationCount: 0, synced: 0, failures: [] };

  const { data: formulations, error: formulationError } = await supabase
    .from('formulations')
    .select('id, sage_code')
    .in('sage_code', itemCodes);
  if (formulationError) throw new Error(`Could not load MES finished goods: ${formulationError.message}`);

  const { data: unitSettings, error: unitSettingsError } = await supabase
    .from('sage_product_integration_settings')
    .select('sage_code, kg_per_sage_unit')
    .in('sage_code', itemCodes);
  if (unitSettingsError) throw new Error(`Could not load Sage finished-good unit settings: ${unitSettingsError.message}`);
  const kgPerUnitByCode = new Map((unitSettings || []).map((setting) => [
    String(setting.sage_code || '').trim().toUpperCase(),
    Number(setting.kg_per_sage_unit || 1),
  ]));

  const requestedCodes = (warehouseCodes || []).map((code) => String(code).trim().toUpperCase()).filter(Boolean);
  let warehouses = requestedCodes.length
    ? FINISHED_GOODS_WAREHOUSES.filter((warehouse) => requestedCodes.includes(warehouse.code))
    : FINISHED_GOODS_WAREHOUSES;
  const missingCodes = requestedCodes.filter((code) => !warehouses.some((warehouse) => warehouse.code === code));
  if (missingCodes.length) {
    const { data: configuredWarehouses, error: warehouseError } = await supabase
      .from('warehouses')
      .select('sage_warehouse_code, sage_warehouse_id')
      .in('sage_warehouse_code', missingCodes)
      .eq('type', 'finished_goods')
      .eq('is_active', true);
    if (warehouseError) throw new Error(`Could not load configured Sage branch warehouses: ${warehouseError.message}`);
    const { data: configuredBranches, error: branchError } = await supabase
      .from('branches')
      .select('sage_warehouse_code, sage_warehouse_id')
      .in('sage_warehouse_code', missingCodes)
      .eq('is_active', true);
    if (branchError) throw new Error(`Could not load configured Sage branch warehouses: ${branchError.message}`);
    warehouses = warehouses.concat((configuredWarehouses || []).concat(configuredBranches || [])
      .filter((warehouse) => warehouse.sage_warehouse_code && Number.isInteger(Number(warehouse.sage_warehouse_id)))
      .map((warehouse) => ({ code: String(warehouse.sage_warehouse_code).trim().toUpperCase(), id: Number(warehouse.sage_warehouse_id) })));
  }
  let synced = 0;
  const failures = [];
  for (const formulation of formulations || []) {
    const itemCode = (formulation.sage_code || '').trim().toUpperCase();
    if (!itemCode) continue;
    const kgPerSageUnit = kgPerUnitByCode.get(itemCode) || 1;
    for (const warehouse of warehouses) {
      try {
        const stock = await getJson(`${SDK_BASE_URL}/api/v1/stock?itemCode=${encodeURIComponent(itemCode)}&warehouse=${warehouse.code}`);
        const now = new Date().toISOString();
        const { error } = await supabase.from('sage_stock_balances').upsert({
          raw_material_id: null,
          formulation_id: formulation.id,
          macropack_bom_id: null,
          sage_code: itemCode,
          warehouse_id: warehouse.id,
          // Sage reports the stocked finished-good unit; MES records operational kg.
          quantity: Number(stock.quantity || 0) * kgPerSageUnit,
          last_synced_at: now,
          updated_at: now,
        }, { onConflict: 'sage_code,warehouse_id' });
        if (error) throw new Error(error.message);
        synced += 1;
      } catch (error) {
        failures.push(`${itemCode}/${warehouse.code}: ${error.message}`);
      }
    }
  }

  return { formulationCount: (formulations || []).length, synced, failures };
}

function validatedStockQuantity(value) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) {
    throw new Error('Sage did not return a valid numeric stock quantity.');
  }
  return Number(value);
}

module.exports = { syncSageStock, syncFinishedGoodsStock };
