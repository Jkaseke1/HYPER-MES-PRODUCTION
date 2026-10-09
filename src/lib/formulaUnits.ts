type Material = { name?: string; category?: string; unit?: string };
type BomLine = { raw_material_id: string; quantity: number; unit?: string; raw_materials?: Material };

export function formulaMassFactor(unit?: string): number | null {
  const key = (unit || 'kg').trim().toLowerCase().replace(/[.\s]/g, '');
  if (['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'].includes(key)) return 1;
  if (['g', 'gm', 'gms', 'gram', 'grams'].includes(key)) return 0.001;
  if (['mg', 'milligram', 'milligrams'].includes(key)) return 0.000001;
  if (['t', 'tonne', 'tonnes', 'metricton', 'metrictons'].includes(key)) return 1000;
  return null;
}

export function isCountedBomLine(line: BomLine, material?: Material): boolean {
  const source = material || line.raw_materials;
  // A feed ingredient measured per bag/each needs a verified pack weight;
  // do not silently exclude it from the recipe as if it were packaging.
  return /packaging/i.test(`${source?.name || ''} ${source?.category || ''}`);
}

// Convert before summing: packaging counts are not part of a feed mass balance.
export function normalizeFormulaBom<T extends BomLine>(lines: T[], materials: (Material & { id: string })[] = [], batchKg?: number) {
  const mass: (T & { unit: string })[] = [];
  const counted: (T & { unit: string })[] = [];
  for (const line of lines) {
    const material = materials.find((item) => item.id === line.raw_material_id) || line.raw_materials;
    const unit = line.unit?.trim() || material?.unit || 'kg';
    if (!Number.isFinite(Number(line.quantity)) || Number(line.quantity) < 0) throw new Error('BOM quantities must be finite and non-negative.');
    if (isCountedBomLine({ ...line, unit }, material)) {
      counted.push({ ...line, quantity: Number(line.quantity), unit });
      continue;
    }
    const factor = formulaMassFactor(unit);
    if (factor === null) throw new Error(`Cannot convert ${material?.name || line.raw_material_id} from "${unit}" to kg. Confirm its Sage unit before editing.`);
    mass.push({ ...line, quantity: Number(line.quantity) * factor, unit: 'kg' });
  }
  const totalKg = mass.reduce((sum, line) => sum + line.quantity, 0);
  if (batchKg !== undefined && (!(batchKg > 0) || !(totalKg > 0))) throw new Error('A positive mass-based BOM is required for a kg formula.');
  const scale = batchKg === undefined ? 1 : batchKg / totalKg;
  return {
    mass: mass.map((line) => ({ ...line, quantity: line.quantity * scale })),
    counted: counted.map((line) => ({ ...line, quantity: line.quantity * scale })),
    totalKg,
  };
}
