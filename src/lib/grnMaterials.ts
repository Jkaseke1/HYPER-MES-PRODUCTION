export const grnMaterialGroups = ['Raw materials', 'Packaging', 'Premixes', 'Additives & minerals', 'Other supplies'] as const;

export function grnMaterialGroup(material: { name: string; category?: string }) {
  const text = `${material.category || ''} ${material.name}`.toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g, '');
  if (/packag|packing|\bbags?\b|\bsacks?\b|\btrays?\b|polyprop|woven|liners?\b/.test(text)) return 'Packaging';
  if (/premix|pre-mix/.test(text)) return 'Premixes';
  if (/additive|mineral|vitamin|amino|methionine|lysine|salinomycin|sulphur|sulfur|limestone|salt|phosphor|phosphate/.test(text)) return 'Additives & minerals';
  if (/cash|float|cement|vaccine|medicine|\b\d+\s*(ml|doses|ds)\b/.test(text)) return 'Other supplies';
  if (/raw[ _-]?materials?|grains?|cereals?|protein|oilseed|bran|maize|soya|soybean|barley|wheat|cotton|sunflower|molasses|sorghum|hulls?|straw|\bfines\b/.test(text)) return 'Raw materials';
  return 'Other supplies';
}

export function isGrnInput(material: { name: string; code: string; sage_code?: string; category?: string }, finishedCodes: Set<string>) {
  if ([material.code, material.sage_code].some((code) => code && finishedCodes.has(code.trim().toUpperCase()))) return false;
  const text = `${material.category || ''} ${material.name}`.toLowerCase();
  if (/packaging|premix|pre-mix/.test(text)) return true;
  return !/^(feed|feeds|finished_goods|finished goods)$/i.test(material.category || '')
    && !/finished[ _-]?(goods|feeds?|products?)|\bfeeds\b|\b(pig|broiler|layer|poultry|beef|cattle|rabbit|dog|horse|goat|sheep)\b.*\b(feed|food|meal|pellets?|crumbles?|concentrate|mash|starter|grower|finisher)\b/.test(text);
}
