export interface CostedPackaging {
  packaging_sku_id: string;
  planned_qty: number;
  actual_qty: number;
  unit_cost: number;
}

export function packagingCost(items: CostedPackaging[], planned = false,
  declarations?: Array<{ packaging_sku_id: string; bags_used: number }>) {
  return items.reduce((total, item) => {
    const used = declarations?.filter(line => line.packaging_sku_id === item.packaging_sku_id);
    const quantity = planned ? Number(item.planned_qty) : used?.length
      ? used.reduce((sum, line) => sum + Number(line.bags_used), 0) : Number(item.actual_qty);
    return total + quantity * Number(item.unit_cost || 0);
  }, 0);
}

export function hasUncostedPackaging(items: CostedPackaging[]) {
  return !items.length || items.some(item => !Number.isFinite(Number(item.unit_cost)) || Number(item.unit_cost) <= 0);
}
