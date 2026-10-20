interface ReceiptLine {
  id: string;
  status: string;
  production_approved_at?: string | null;
}

export function incomingReceiptBlockReason(
  pending: ReceiptLine[],
  syncById: Record<string, unknown>,
  reversalById: Record<string, { status: string }>,
): string | null {
  if (!pending.length) return 'No lines are awaiting Production receipt.';
  if (pending.some(line => line.status !== 'in_buffer' || line.production_approved_at)) {
    return 'A pending line already has a receipt or changed status. Refresh and verify it.';
  }
  if (pending.some(line => Boolean(syncById[line.id]))) {
    return 'An outstanding line already has Sage queue history. Verify its posting before receiving it again.';
  }
  if (pending.some(line => reversalById[line.id] && reversalById[line.id].status !== 'cancelled')) {
    return 'An outstanding line has a return record. Reconcile it before receiving.';
  }
  return null;
}
