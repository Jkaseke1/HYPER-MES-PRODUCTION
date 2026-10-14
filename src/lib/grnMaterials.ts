export const grnMaterialGroups = ['Raw materials', 'Packaging', 'Premixes', 'Additives & minerals'] as const;

export function grnMaterialGroup(material: { name: string; category?: string }) {
  const text = `${material.category || ''} ${material.name}`.toLowerCase();
  if (/packaging|bags?\b|sacks?\b/.test(text)) return 'Packaging';
  if (/premix|pre-mix/.test(text)) return 'Premixes';
  if (/additive|mineral|vitamin|amino|methionine|lysine|salinomycin|sulphur|sulfur|limestone|salt/.test(text)) return 'Additives & minerals';
  return 'Raw materials';
}

export function isGrnInput(material: { name: string; code: string; sage_code?: string; category?: string }, finishedCodes: Set<string>) {
  if ([material.code, material.sage_code].some((code) => code && finishedCodes.has(code.trim().toUpperCase()))) return false;
  const text = `${material.category || ''} ${material.name}`.toLowerCase();
  if (/packaging|premix|pre-mix/.test(text)) return true;
  return !/^(feed|feeds|finished_goods|finished goods)$/i.test(material.category || '')
    && !/finished[ _-]?(goods|feeds?|products?)|\bfeeds\b|\b(pig|broiler|layer|poultry|beef|cattle|rabbit|dog|horse|goat|sheep)\b.*\b(meal|pellets?|crumbles?|concentrate|mash|starter|grower|finisher)\b/.test(text);
}
