async function getSageProductUnitSettings(supabase, formulationId, itemCode) {
  let query = supabase
    .from('sage_product_integration_settings')
    .select('sage_code, kg_per_sage_unit, posting_cost_mode');

  query = formulationId
    ? query.eq('formulation_id', formulationId)
    : query.eq('sage_code', itemCode);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Could not load Sage product unit settings for ${itemCode}: ${error.message}`);

  const kgPerSageUnit = Number(data?.kg_per_sage_unit || 1);
  if (!Number.isFinite(kgPerSageUnit) || kgPerSageUnit <= 0) {
    throw new Error(`Invalid Sage stock-unit setting for ${itemCode}.`);
  }

  return { kgPerSageUnit, postingCostMode: data?.posting_cost_mode || 'sage_average' };
}

function toSageUnits(quantityKg, kgPerSageUnit, itemCode) {
  const units = Number(quantityKg) / Number(kgPerSageUnit);
  if (!Number.isFinite(units) || units <= 0 || Math.abs(units - Math.round(units)) > 0.0001) {
    throw new Error(`${itemCode} quantity ${quantityKg}kg is not an exact ${kgPerSageUnit}kg Sage stock-unit quantity.`);
  }
  return Math.round(units);
}

module.exports = { getSageProductUnitSettings, toSageUnits };
