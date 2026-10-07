// Imports Sage BOM masters and manufacturing history into PlantControl.
// Sage is SELECT-only. Run without flags for a preview. Use the explicit
// apply flags only after reviewing the preview output.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', 'sage-sdk-api', '.env') });
const sql = require('mssql');
const { createClient } = require('@supabase/supabase-js');

const applyFormulas = process.argv.includes('--apply-formulas');
const applyHistory = process.argv.includes('--apply-history');
const clean = (value) => String(value ?? '').trim();
const number = (value) => Number(value || 0);
const code = (value) => clean(value).toUpperCase();

const sageConfig = {
  server: process.env.SAGE_SERVER || process.env.HYPER_SAGE_SERVER || 'localhost',
  port: Number(process.env.SAGE_PORT || process.env.HYPER_SAGE_PORT || 1433),
  database: process.env.SAGE_DATABASE || process.env.HYPER_SAGE_COMPANY_DATABASE,
  user: process.env.SAGE_USER || process.env.HYPER_SAGE_SQL_USERNAME,
  password: process.env.SAGE_PASSWORD || process.env.HYPER_SAGE_SQL_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
};
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function sageRows(pool, query) {
  return (await pool.request().query(query)).recordset;
}

async function chunks(rows, size, fn) {
  for (let index = 0; index < rows.length; index += size) await fn(rows.slice(index, index + size));
}

async function fetchBomSource(pool) {
  const boms = await sageRows(pool, `
    SELECT bm.BomID, bm.BomStockLink, bm.BomStockCode, bm.BomDescription,
      bm.BomProductionQty, bm.BomUnitCost, bm.DateLastCosted, bm.BomMast_dModifiedDate,
      si.Code AS FinishedGoodCode, si.Description_1 AS FinishedGoodName
    FROM dbo.BomMast bm
    LEFT JOIN dbo.StkItem si ON si.StockLink = bm.BomStockLink
    WHERE bm.BomID IS NOT NULL
    ORDER BY bm.BomID;`);
  const components = await sageRows(pool, `
    SELECT bc.BomComponentKey, bc.BomMasterKey, bc.ComponentStockLink, bc.ComponentIndex,
      bc.ProductionQty, bc.UnitOfMeasure, bc.UnitCost, bc.Description,
      si.Code AS ComponentCode, si.Description_1 AS ComponentName
    FROM dbo.BomComp bc
    LEFT JOIN dbo.StkItem si ON si.StockLink = bc.ComponentStockLink
    WHERE bc.BomMasterKey IS NOT NULL
    ORDER BY bc.BomMasterKey, bc.ComponentIndex, bc.BomComponentKey;`);
  return { boms, components };
}

async function importFormulas(pool) {
  const { boms, components } = await fetchBomSource(pool);
  const componentsByBom = new Map();
  for (const component of components) {
    const list = componentsByBom.get(component.BomMasterKey) || [];
    list.push(component); componentsByBom.set(component.BomMasterKey, list);
  }
  const invalid = boms.filter((bom) => !code(bom.FinishedGoodCode || bom.BomStockCode) || !(componentsByBom.get(bom.BomID) || []).length);
  const materialCodes = [...new Set(components.map((item) => code(item.ComponentCode)).filter(Boolean))];
  console.table([{ sage_boms: boms.length, sage_components: components.length, component_materials: materialCodes.length, invalid_boms: invalid.length }]);
  if (!applyFormulas) return console.log('PREVIEW ONLY: no PlantControl formula or material data was changed.');

  const { data: existingMaterials, error: materialError } = await supabase
    .from('raw_materials').select('id, code, sage_code').limit(5000);
  if (materialError) throw materialError;
  const materialByCode = new Map((existingMaterials || []).flatMap((item) => [[code(item.sage_code), item], [code(item.code), item]]).filter(([key]) => key));
  const missingComponents = components.filter((item) => code(item.ComponentCode) && !materialByCode.has(code(item.ComponentCode)));
  const uniqueMissing = [...new Map(missingComponents.map((item) => [code(item.ComponentCode), item])).values()];
  await chunks(uniqueMissing, 100, async (group) => {
    const payload = group.map((item) => ({
      code: clean(item.ComponentStockLink), sage_code: code(item.ComponentCode),
      name: clean(item.ComponentName) || clean(item.Description) || code(item.ComponentCode),
      description: clean(item.Description), unit: clean(item.UnitOfMeasure) || 'kg',
      reorder_level: 0, current_stock: 0, is_active: true,
    }));
    const { error } = await supabase.from('raw_materials').upsert(payload, { onConflict: 'code' });
    if (error) throw new Error(`Could not import Sage BOM component masters: ${error.message}`);
  });
  const { data: refreshedMaterials, error: refreshedError } = await supabase
    .from('raw_materials').select('id, code, sage_code').limit(5000);
  if (refreshedError) throw refreshedError;
  const refreshedByCode = new Map((refreshedMaterials || []).flatMap((item) => [[code(item.sage_code), item], [code(item.code), item]]).filter(([key]) => key));

  let imported = 0; let skipped = 0; let ingredientRows = 0;
  for (const bom of boms) {
    const sageCode = code(bom.FinishedGoodCode || bom.BomStockCode);
    const bomComponents = componentsByBom.get(bom.BomID) || [];
    const mapped = bomComponents.map((item) => ({ item, material: refreshedByCode.get(code(item.ComponentCode)) }));
    if (!sageCode || !mapped.length || mapped.some(({ material }) => !material)) { skipped++; continue; }
    const { data: byBom, error: byBomError } = await supabase.from('formulations')
      .select('id, sage_bom_id, sage_code').eq('sage_bom_id', bom.BomID).maybeSingle();
    if (byBomError) throw byBomError;
    let formulation = byBom;
    if (!formulation) {
      const { data: sameSage, error: sameSageError } = await supabase.from('formulations')
        .select('id, sage_bom_id, sage_code').eq('sage_code', sageCode).maybeSingle();
      if (sameSageError) throw sameSageError;
      if (sameSage && sameSage.sage_bom_id == null) { skipped++; continue; }
      formulation = sameSage;
    }
    const batchSize = number(bom.BomProductionQty) > 0 ? number(bom.BomProductionQty) : 1000;
    const payload = {
      name: clean(bom.FinishedGoodName) || clean(bom.BomDescription) || sageCode,
      code: sageCode, sage_code: sageCode, sage_bom_id: bom.BomID,
      description: clean(bom.BomDescription), batch_size: batchSize, batch_unit: 'kg',
      estimated_cost_per_unit: number(bom.BomUnitCost), status: 'active',
      sage_source_updated_at: bom.BomMast_dModifiedDate || bom.DateLastCosted || null,
      sage_imported_at: new Date().toISOString(),
    };
    let formulationId = formulation?.id;
    if (formulationId) {
      const { error } = await supabase.from('formulations').update(payload).eq('id', formulationId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from('formulations').insert({ ...payload, version: 1 }).select('id').single();
      if (error) throw error; formulationId = data.id;
    }
    const { error: deleteError } = await supabase.from('formulation_ingredients').delete().eq('formulation_id', formulationId);
    if (deleteError) throw deleteError;
    const lines = mapped.map(({ item, material }, index) => ({
      formulation_id: formulationId, raw_material_id: material.id, quantity: number(item.ProductionQty),
      unit: clean(item.UnitOfMeasure) || 'kg', percentage: (number(item.ProductionQty) / batchSize) * 100,
      is_critical: false, notes: `Imported from Sage BOM ${bom.BomID}`, sort_order: Number(item.ComponentIndex || index),
    }));
    await chunks(lines, 100, async (group) => {
      const { error } = await supabase.from('formulation_ingredients').insert(group);
      if (error) throw error;
    });
    imported++; ingredientRows += lines.length;
  }
  console.table([{ formulas_imported: imported, formula_components_imported: ingredientRows, formulas_skipped: skipped, component_masters_added: uniqueMissing.length }]);
}

async function importHistory(pool) {
  const processes = await sageRows(pool, `
    SELECT p.idManufProcess, p.iStatus, p.cProcessRefNumber, p.cOtherRefNumber, p.iBOMMasterID,
      p.cManufDescription, p.dCreated, p.dLastUpdated, p.fManufQuantity, p.fQtyManufactured,
      p.iManufWarehouseID, p._etblManufProcess_iBranchID, p.dProjectedCompletionDate, p.dActualCompletionDate,
      bm.BomStockCode, si.Code AS FinishedGoodCode, si.Description_1 AS FinishedGoodName
    FROM dbo._etblManufProcess p
    LEFT JOIN dbo.BomMast bm ON bm.BomID = p.iBOMMasterID
    LEFT JOIN dbo.StkItem si ON si.StockLink = bm.BomStockLink
    ORDER BY p.idManufProcess;`);
  const lines = await sageRows(pool, `
    SELECT l.idManufProcessLine, l.iManufProcessID, l.iAction, l.iLineNo, l.cReference,
      l.iInvItemID, l.iWarehouseID, l.fQuantity, l.fCost, l.fLineCost, l.bProcessed, l.dTransactionDate,
      si.StockLink, si.Code AS ItemCode, si.Description_1 AS ItemName
    FROM dbo._etblManufProcessLine l
    LEFT JOIN dbo.StkItem si ON si.StockLink = l.iInvItemID
    ORDER BY l.iManufProcessID, l.iLineNo, l.idManufProcessLine;`);
  console.table([{ sage_processes: processes.length, sage_process_lines: lines.length }]);
  if (!applyHistory) return console.log('PREVIEW ONLY: no PlantControl manufacturing-history data was changed.');
  const stamp = new Date().toISOString();
  await chunks(processes, 250, async (group) => {
    const rows = group.map((p) => ({ sage_process_id: p.idManufProcess, process_reference: clean(p.cProcessRefNumber), external_reference: clean(p.cOtherRefNumber), sage_bom_id: p.iBOMMasterID,
      finished_good_code: code(p.FinishedGoodCode || p.BomStockCode), finished_good_name: clean(p.FinishedGoodName), description: clean(p.cManufDescription), source_status: clean(p.iStatus), planned_quantity: number(p.fManufQuantity), manufactured_quantity: number(p.fQtyManufactured), warehouse_id: p.iManufWarehouseID, branch_id: p._etblManufProcess_iBranchID, source_created_at: p.dCreated, source_updated_at: p.dLastUpdated, projected_completion_at: p.dProjectedCompletionDate, actual_completion_at: p.dActualCompletionDate, imported_at: stamp }));
    const { error } = await supabase.from('sage_manufacturing_history').upsert(rows, { onConflict: 'sage_process_id' }); if (error) throw error;
  });
  await chunks(lines, 250, async (group) => {
    const rows = group.map((l) => ({ sage_process_line_id: l.idManufProcessLine, sage_process_id: l.iManufProcessID, action_code: l.iAction, line_number: l.iLineNo, reference: clean(l.cReference), item_stock_link: l.StockLink, item_code: code(l.ItemCode), item_name: clean(l.ItemName), warehouse_id: l.iWarehouseID, quantity: number(l.fQuantity), unit_cost: number(l.fCost), line_cost: number(l.fLineCost), processed: Boolean(l.bProcessed), transaction_at: l.dTransactionDate, imported_at: stamp }));
    const { error } = await supabase.from('sage_manufacturing_history_lines').upsert(rows, { onConflict: 'sage_process_line_id' }); if (error) throw error;
  });
  console.log(`Imported ${processes.length} Sage manufacturing processes and ${lines.length} lines as read-only history.`);
}

async function main() {
  if (!sageConfig.database || !sageConfig.user || !sageConfig.password) throw new Error('Sage connection settings are incomplete.');
  console.log(`Sage ${sageConfig.database}: ${applyFormulas || applyHistory ? 'APPLYING to PlantControl only' : 'PREVIEW only'}`);
  const pool = await sql.connect(sageConfig);
  try { await importFormulas(pool); await importHistory(pool); }
  finally { await sql.close(); }
}
main().catch((error) => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });
