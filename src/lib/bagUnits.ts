/** Finished goods are posted to Sage in kilograms; bags are the shop-floor unit. */
export function bagSizeKg(value: unknown, fallback = 50): number {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function bagsFromKg(quantityKg: unknown, sizeKg: unknown): number {
  const bags = Number(quantityKg || 0) / bagSizeKg(sizeKg);
  return Math.round((bags + Number.EPSILON) * 1000) / 1000;
}

export function kgFromBags(bags: unknown, sizeKg: unknown): number {
  const kg = Number(bags || 0) * bagSizeKg(sizeKg);
  return Math.round((kg + Number.EPSILON) * 1000) / 1000;
}

export function formatBags(quantityKg: unknown, sizeKg: unknown): string {
  return bagsFromKg(quantityKg, sizeKg).toLocaleString(undefined, { maximumFractionDigits: 3 });
}
