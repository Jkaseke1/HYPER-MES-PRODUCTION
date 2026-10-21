export const grnMaterialGroups = ['Raw materials', 'Packaging', 'Premixes', 'Additives & minerals', 'Other supplies', 'Needs category review'] as const;
type MaterialGroup = typeof grnMaterialGroups[number];
const normalize = (value: string | null | undefined) => (value || '').toLowerCase()
  .replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

const categoryGroups: Record<string, MaterialGroup> = {
  'raw material': 'Raw materials', 'raw materials': 'Raw materials', rm: 'Raw materials',
  ingredient: 'Raw materials', ingredients: 'Raw materials', grain: 'Raw materials', grains: 'Raw materials',
  cereal: 'Raw materials', cereals: 'Raw materials', protein: 'Raw materials', oilseed: 'Raw materials',
  packaging: 'Packaging', 'packaging material': 'Packaging', 'packaging materials': 'Packaging',
  packing: 'Packaging', packadging: 'Packaging', bags: 'Packaging', sacks: 'Packaging',
  premix: 'Premixes', premixes: 'Premixes', 'pre mix': 'Premixes', 'pre mixes': 'Premixes',
  additive: 'Additives & minerals', additives: 'Additives & minerals', mineral: 'Additives & minerals',
  minerals: 'Additives & minerals', 'additives & minerals': 'Additives & minerals',
  'additives and minerals': 'Additives & minerals', vitamins: 'Additives & minerals',
  'other supplies': 'Other supplies', supplies: 'Other supplies', consumables: 'Other supplies',
  medicine: 'Other supplies', medicines: 'Other supplies', vaccines: 'Other supplies',
};

export function grnMaterialGroup(material: { name: string; category?: string | null }): MaterialGroup {
  const category = normalize(material.category);
  if (Object.prototype.hasOwnProperty.call(categoryGroups, category)) return categoryGroups[category];
  const text = normalize(material.name);
  // Missing/legacy categories fall back to names, never broad SKU prefixes (e.g. PARA500).
  if (/\bpacka(?:d)?g\w*|\bpacking\b|\bbags?\b|\bsacks?\b|\btrays?\b|polyprop|\bwoven\b|\bliners?\b/.test(text)) return 'Packaging';
  if (/\bpre\s*mix(?:es)?\b/.test(text)) return 'Premixes';
  if (/additive|mineral|vitamin|amino|methionine|lysine|salinomycin|sulphur|sulfur|limestone|\bsalt\b|phosphor|phosphate|\bmagnesium\b|\bcalcium\b|\bsodium\b|\bbicarbonate\b|\bcholine\b|\bthreonine\b|\btryptophan\b/.test(text)) return 'Additives & minerals';
  if (/\bcash\b|\bfloat\b|\bcement\b|vaccine|medicine|\b\d+\s*(ml|doses|ds)\b/.test(text)) return 'Other supplies';
  if (/raw materials?|grains?|cereals?|protein|oilseed|bran|maize|soya|soybean|barley|wheat|cotton|sunflower|molasses|sorghum|hulls?|straw|\bfines\b|\bmillet\b|\blucerne\b|\bcanola\b|\brapeseed\b|\bgroundnuts?\b|\bmealie\b|\bcarcass meal\b|\bblood meal\b|\bfish\s*meal\b|\bfeather meal\b|\bmeat.*bone meal\b|\bvegetable oil\b|\bpalm oil\b/.test(text)) return 'Raw materials';
  return 'Needs category review';
}

export function isGrnInput(material: { name: string; code: string; sage_code?: string; category?: string }, finishedCodes: Set<string>) {
  // This purchased protein also has a manufacturing formulation in Sage.
  const purchasedSoya = (material.sage_code?.trim() || material.code.trim()).toUpperCase() === 'FFS0001'
    && (material.category || '').trim().toLowerCase() === 'protein'
    && material.name.trim().replace(/\s+/g, ' ').toLowerCase() === 'full fat soya meal';
  if (!purchasedSoya && [material.code, material.sage_code].some((code) => code && finishedCodes.has(code.trim().toUpperCase()))) return false;
  const text = `${material.category || ''} ${material.name}`.toLowerCase();
  if (/packaging|premix|pre-mix/.test(text)) return true;
  return !/^(feed|feeds|finished_goods|finished goods)$/i.test(material.category || '')
    && !/finished[ _-]?(goods|feeds?|products?)|\bfeeds\b|\b(pig|broiler|layer|poultry|beef|cattle|rabbit|dog|horse|goat|sheep)\b.*\b(feed|food|meal|pellets?|crumbles?|concentrate|mash|starter|grower|finisher)\b/.test(text);
}
