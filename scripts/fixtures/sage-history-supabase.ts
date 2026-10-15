// Isolated browser fixture. Never contacts a database or ERP.
const sample = (index: number) => ({
  id: `event-${index}`, reference_id: `transfer-${index}`,
  event_type: index === 1 ? 'material_transfer_return_to_rm' : 'material_transfer_to_production',
  status: index === 2 ? 'failed' : 'success',
  message: index === 2 ? 'Request timed out; verify Sage before retrying.' : 'Posted to Sage: HFIST11582',
  details: { sdkTransfer: { reference: 'HFIST11582', itemCode: 'MAW0001', quantity: 100, reference2: `MES line ${index}` } },
  sage_response: index === 3 ? { environment: 'UAT' } : { environment: 'Production', companyDatabase: 'Hyperfeeds 2024', sagePosting: 'completed' },
  error_details: index === 2 ? { postingOutcomeUnknown: true } : {}, retry_count: 0,
  created_at: '2026-09-11T08:00:00Z', updated_at: '2026-09-11T08:01:00Z',
});
const logs = Array.from({ length: 503 }, (_, index) => sample(index));
export const supabase = {
  from(table: string) {
    let ids: string[] = [];
    let start = 0;
    let end = 499;
    const query = {
      select() { return query; }, in(column: string, values: string[]) { if (column === 'id') ids = values; return query; },
      lte() { return query; }, order() { return query; },
      range(first: number, last: number) { start = first; end = last; return query; }, returns() { return query; },
      then(resolve: (result: unknown) => void) {
        const mode = new URLSearchParams(location.search).get('mode');
        if (mode === 'error') return Promise.resolve({ data: null, error: { message: 'Fixture access denied' } }).then(resolve);
        const data = mode === 'empty' ? [] : table === 'sync_log' ? logs.slice(start, end + 1) : ids.map(id => ({
          id, transfer_number: `MT-${id}`, purpose: 'HFIST11582', transfer_date: '2026-09-07', quantity: 100, unit: 'kg',
          reversal_number: table === 'material_transfer_reversals' ? 'HFRV11582-TEST' : undefined,
          original_transfer_id: table === 'material_transfer_reversals' ? 'transfer-0' : undefined,
          reversed_at: id === 'transfer-0' ? '2026-09-12T08:00:00Z' : null,
          raw_materials: { name: 'Maize White', code: 'MAW0001' },
        }));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return query;
  },
};
