import { supabase } from './supabase';

export interface StockCheckResult {
  isValid: boolean;
  errors: StockError[];
}

export interface StockError {
  materialId: string;
  materialName: string;
  available: number;
  requested: number;
  shortfall: number;
}

/**
 * Check if materials have sufficient stock before issuing
 * @param materials Array of {raw_material_id, quantity} to check
 * @returns StockCheckResult with validation status and any errors
 */
export async function validateStockAvailability(
  materials: Array<{ raw_material_id: string; quantity: number; name?: string }>
): Promise<StockCheckResult> {
  if (!materials || materials.length === 0) {
    return { isValid: true, errors: [] };
  }

  try {
    const materialIds = materials.map((m) => m.raw_material_id);

    // Fetch raw_materials current_stock, warehouse_stock_balances, and internal material_transfers concurrently
    const [stockRes, balancesRes, transfersRes] = await Promise.all([
      supabase.from('raw_materials').select('id, name, current_stock').in('id', materialIds),
      supabase.from('warehouse_stock_balances').select('raw_material_id, quantity').in('raw_material_id', materialIds),
      supabase.from('material_transfers').select('raw_material_id, quantity').in('raw_material_id', materialIds).in('status', ['in_buffer', 'approved', 'received', 'in_transit']),
    ]);

    const stockData = stockRes.data || [];
    const balancesData = balancesRes.data || [];
    const transfersData = transfersRes.data || [];

    const errors: StockError[] = [];

    for (const material of materials) {
      const stockItem = stockData.find((s: any) => s.id === material.raw_material_id);
      const globalStock = Number(stockItem?.current_stock || 0);

      // Sum quantities in warehouse_stock_balances
      const whStockSum = balancesData
        .filter((b: any) => b.raw_material_id === material.raw_material_id)
        .reduce((sum: number, b: any) => sum + Number(b.quantity || 0), 0);

      // Sum quantities transferred internally to Buffer / Production
      const transferredSum = transfersData
        .filter((t: any) => t.raw_material_id === material.raw_material_id)
        .reduce((sum: number, t: any) => sum + Number(t.quantity || 0), 0);

      // Available stock is the maximum available across global stock, warehouse balances, or internal transfers
      const available = Math.max(globalStock, whStockSum, transferredSum, globalStock + transferredSum);
      const requested = material.quantity;

      if (available < requested) {
        errors.push({
          materialId: material.raw_material_id,
          materialName: stockItem?.name || material.name || 'Unknown Material',
          available: Math.round(available * 100) / 100,
          requested: Math.round(requested * 100) / 100,
          shortfall: Math.round((requested - available) * 100) / 100,
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  } catch (error) {
    console.error('Stock validation error:', error);
    return {
      isValid: false,
      errors: [
        {
          materialId: '',
          materialName: 'System Error',
          available: 0,
          requested: 0,
          shortfall: 0,
        },
      ],
    };
  }
}

/**
 * Check if finished goods have sufficient stock before dispatch (uses Sage stock balances)
 */
export async function validateFGStockAvailability(
  items: Array<{ formulation_id: string; quantity: number; name?: string }>
): Promise<StockCheckResult> {
  if (!items || items.length === 0) return { isValid: true, errors: [] };

  try {
    const formulationIds = items.map((i) => i.formulation_id).filter(Boolean);

    const { data: formulations } = await supabase
      .from('formulations')
      .select('id, sage_code, name')
      .in('id', formulationIds);

    const sageCodes = (formulations || []).map((f: any) => f.sage_code).filter(Boolean);
    const DEB_SAGE_WAREHOUSE_ID = 17;

    const { data: sageStock } = await supabase
      .from('sage_stock_balances')
      .select('sage_code, quantity')
      .eq('warehouse_id', DEB_SAGE_WAREHOUSE_ID)
      .in('sage_code', sageCodes);

    const stockMap: Record<string, number> = {};
    for (const row of sageStock || []) {
      stockMap[(row as any).sage_code] = Number((row as any).quantity || 0);
    }

    const errors: StockError[] = [];
    for (const item of items) {
      const formulation = formulations?.find((f: any) => f.id === item.formulation_id);
      const sageCode = formulation?.sage_code;
      const available = sageCode ? (stockMap[sageCode] || 0) : 0;
      if (available < item.quantity) {
        errors.push({
          materialId: item.formulation_id,
          materialName: item.name || formulation?.name || 'Unknown Product',
          available,
          requested: item.quantity,
          shortfall: item.quantity - available,
        });
      }
    }

    return { isValid: errors.length === 0, errors };
  } catch (error) {
    console.error('FG stock validation error:', error);
    return {
      isValid: false,
      errors: [{ materialId: '', materialName: 'System Error', available: 0, requested: 0, shortfall: 0 }],
    };
  }
}

/**
 * Log a stock exception when override is needed
 */
export async function logStockException(
  transactionType: string,
  materialName: string,
  availableQty: number,
  requestedQty: number,
  overrideReason: string
): Promise<boolean> {
  try {
    const { data: user } = await supabase.auth.getUser();
    if (!user?.user?.id) return false;

    const { error } = await supabase.from('stock_exceptions').insert({
      transaction_type: transactionType,
      material_name: materialName,
      available_qty: availableQty,
      requested_qty: requestedQty,
      shortfall_qty: requestedQty - availableQty,
      override_reason: overrideReason,
      overridden_by: user.user.id,
    });

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Failed to log stock exception:', error);
    return false;
  }
}

/**
 * Format stock error message for display
 */
export function formatStockErrorMessage(errors: StockError[]): string {
  if (errors.length === 0) return '';

  const lines = errors.map(
    (e) =>
      `${e.materialName}: ${e.available.toFixed(2)}kg available, ${e.requested.toFixed(2)}kg required (short by ${e.shortfall.toFixed(2)}kg)`
  );

  return `Insufficient stock:\n${lines.join('\n')}`;
}
