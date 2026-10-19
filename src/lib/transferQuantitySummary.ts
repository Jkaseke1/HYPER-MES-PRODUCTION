interface QuantityLine {
  quantity: number | string;
  unit?: string | null;
  raw_materials?: { unit?: string | null } | null;
}

export function transferQuantitySummary(lines: QuantityLine[]): string {
  const totals = new Map<string, number>();
  for (const line of lines) {
    const rawUnit = (line.unit?.trim() || line.raw_materials?.unit?.trim() || '').toLowerCase();
    const unit = ['kg', 'kgs', 'kilogram', 'kilograms'].includes(rawUnit) ? 'kg'
      : ['unit', 'units'].includes(rawUnit) ? 'units' : rawUnit || 'unit not recorded';
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity)) continue;
    totals.set(unit, (totals.get(unit) || 0) + quantity);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a === 'kg' ? -1 : b === 'kg' ? 1 : a.localeCompare(b))
    .map(([unit, quantity]) => `${quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${unit}`)
    .join(' + ') || '0';
}
