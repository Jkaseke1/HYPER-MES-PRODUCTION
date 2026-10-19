type StockBalance = { raw_material_id: string; quantity: number | string; is_fresh: boolean };

export function verifiedTransferBalances(materialIds: string[], rows: StockBalance[], warehouse: string) {
  const ids = [...new Set(materialIds)];
  const balances = new Map<string, number>();
  for (const id of ids) {
    const matches = rows.filter(row => row.raw_material_id === id);
    if (matches.length !== 1 || matches[0].is_fresh !== true) {
      throw new Error(`Sage ${warehouse} stock verification is incomplete or expired for material ${id}. No new transfer was created. Check the bridge stock-refresh log before retrying.`);
    }
    const quantity = matches[0].quantity;
    if (quantity === null || quantity === undefined || quantity === '' || !Number.isFinite(Number(quantity))) {
      throw new Error(`Sage ${warehouse} returned an invalid stock quantity. No new transfer was created.`);
    }
    balances.set(id, Number(quantity));
  }
  return balances;
}
