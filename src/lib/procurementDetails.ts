import type { supabase } from './supabase';

export type ProcurementItem = {
  id: string; line_number: number; description: string; specification: string | null;
  quantity: string | number; unit: string;
};
export type ProcurementQuote = {
  id: string; supplier_name: string; quote_reference: string; quote_date: string | null;
  valid_until: string | null; currency_code: string; quote_total: string | number;
};
export type ProcurementHistory = {
  id: string; transaction_date: string; transaction_type: string;
  reference: string | null; audit_number: string; imported_at: string;
};
export type ProcurementDetails = {
  items: ProcurementItem[]; quotes: ProcurementQuote[]; history: ProcurementHistory[];
};

export async function loadProcurementDetails(
  client: Pick<typeof supabase, 'from'>, requestId: string,
): Promise<ProcurementDetails> {
  // Explicit projections exclude bank/account details, raw source payloads and storage paths.
  const results = await Promise.all([
    client.from('maintenance_procurement_items')
      .select('id,line_number,description,specification,quantity,unit', { count: 'exact' })
      .eq('request_id', requestId).order('line_number').limit(200),
    client.from('maintenance_procurement_quotes')
      .select('id,supplier_name,quote_reference,quote_date,valid_until,currency_code,quote_total', { count: 'exact' })
      .eq('request_id', requestId).order('created_at').limit(200),
    client.from('maintenance_procurement_sage_history')
      .select('id,transaction_date,transaction_type,reference,audit_number,imported_at', { count: 'exact' })
      .eq('request_id', requestId).order('transaction_date', { ascending: false }).limit(200),
  ]).catch(() => {
    throw new Error('Could not load all request details. Retry to view the complete record.');
  });
  if (results.some(result => result.error)) {
    // Do not present a partially failed query as a complete evidence record.
    throw new Error('Could not load all request details. Retry to view the complete record.');
  }
  if (results.some(result => result.count === null || result.count !== (result.data || []).length)) {
    throw new Error('The request record is too large to display completely. Contact Finance for a full review.');
  }
  return {
    items: (results[0].data || []) as ProcurementItem[],
    quotes: (results[1].data || []) as ProcurementQuote[],
    history: (results[2].data || []) as ProcurementHistory[],
  };
}
