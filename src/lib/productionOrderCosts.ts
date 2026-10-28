import { formulaMassFactor } from './formulaUnits';

type CostMaterial = {
  unit?: string | null;
  cost_per_unit?: number | null;
  cost_per_unit_usd?: number | null;
};

export function resolveProductionUnitCost({
  lineUnit,
  material,
  costPerTonneUsd,
  counted = false,
}: {
  lineUnit?: string | null;
  material?: CostMaterial | null;
  costPerTonneUsd?: number | null;
  counted?: boolean;
}): number {
  const lineFactor = formulaMassFactor(lineUnit);
  const registeredRate = Number(costPerTonneUsd) || 0;
  if (!counted && registeredRate > 0 && lineFactor !== null) {
    return registeredRate * lineFactor / 1000;
  }

  const nativeCost = Number(material?.cost_per_unit_usd) > 0
    ? Number(material?.cost_per_unit_usd)
    : Number(material?.cost_per_unit) || 0;
  if (nativeCost <= 0) return 0;
  if (counted) return nativeCost;

  const nativeFactor = formulaMassFactor(material?.unit);
  if (lineFactor === null || nativeFactor === null) {
    return (lineUnit || 'kg').trim().toLowerCase() === (material?.unit || 'kg').trim().toLowerCase()
      ? nativeCost
      : 0;
  }
  return nativeCost * lineFactor / nativeFactor;
}
