// rmCostUpdatedAuto.js - MES-only raw material cost register acknowledgement
// GRV posting already carries stock and value into Sage. This event records MES
// costing metadata used for reports, so the bridge verifies it and marks handled.

const { supabase } = require('./lib/db');

async function handleRmCostUpdated(syncEvent) {
  console.log('\n  -> RM Cost Register update (MES-only)');

  const costEntryId = syncEvent.reference_id;
  console.log(`  Cost register ID: ${costEntryId}`);

  const { data: costEntry, error } = await supabase
    .from('rm_cost_register')
    .select(`
      id,
      raw_material_id,
      effective_date,
      cost_per_tonne_usd,
      source,
      grn_id,
      raw_materials (
        id,
        name,
        code,
        sage_code
      )
    `)
    .eq('id', costEntryId)
    .single();

  if (error || !costEntry) {
    throw new Error(`RM cost register entry not found: ${costEntryId} - ${error?.message || 'no row returned'}`);
  }

  const materialCode = costEntry.raw_materials?.sage_code || costEntry.raw_materials?.code || costEntry.raw_material_id;
  const materialName = costEntry.raw_materials?.name || materialCode;
  const source = costEntry.source || 'UNKNOWN';
  const costPerTonne = Number(costEntry.cost_per_tonne_usd || 0);

  console.log(`  Material: ${materialCode} - ${materialName}`);
  console.log(`  Cost: USD ${costPerTonne.toFixed(4)} per tonne, source ${source}`);
  console.log('  Sage posting: not required; GRV posting already updates Sage stock/value');

  return {
    message: `RM cost register acknowledged for ${materialCode}; no separate Sage posting required`,
    details: {
      sagePostingRequired: false,
      reason: 'GRV posting already updates Sage inventory value; rm_cost_updated is MES costing/reporting metadata.',
      rmCostRegister: {
        id: costEntry.id,
        rawMaterialId: costEntry.raw_material_id,
        materialCode,
        materialName,
        effectiveDate: costEntry.effective_date,
        costPerTonneUsd: costPerTonne,
        source,
        grnId: costEntry.grn_id || null,
      },
    },
  };
}

module.exports = { handleRmCostUpdated };
