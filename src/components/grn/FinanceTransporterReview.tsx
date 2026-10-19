import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { transporterRegistrationBlocksApproval } from '../../lib/transporterRegistration';

export default function FinanceTransporterReview({ grnId, onBlocked }: { grnId: string; onBlocked: (blocked: boolean) => void }) {
  const { profile } = useAuth();
  const [record, setRecord] = useState<any>(null);
  const [account, setAccount] = useState('');
  const [supplier, setSupplier] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canResolve = ['admin', 'finance', 'accountant'].includes(profile?.role || '');
  useEffect(() => {
    let active = true;
    onBlocked(true); setRecord(null); setSupplier(null); setError('');
    supabase.from('grn_transporter_registration').select('*').eq('grn_id', grnId).single().then(({ data, error }) => {
      if (!active) return;
      if (error) { setError('Transporter registration could not be checked. Refresh before approving.'); return; }
      setRecord(data);
      onBlocked(transporterRegistrationBlocksApproval(data.registration_status));
    });
    return () => { active = false; };
  }, [grnId, onBlocked]);
  const findSupplier = async () => {
    setBusy(true); setError(''); setSupplier(null);
    try {
      const { data, error } = await supabase.from('suppliers').select('id,name,sage_code').eq('is_active', true).eq('sage_code', account.trim().toUpperCase()).limit(2);
      if (error) throw error;
      if (data?.length !== 1) throw new Error('No unique imported Sage supplier found for this code. Create/update it in Sage and import the supplier first.');
      setSupplier(data[0]);
    } catch (err: any) { setError(err.message || 'Supplier lookup failed.'); }
    finally { setBusy(false); }
  };
  const resolve = async () => {
    if (!record || !supplier) return;
    setBusy(true); setError('');
    try {
      const { error } = await supabase.rpc('resolve_pending_transporter', { p_transporter_id: record.transporter_id, p_supplier_id: supplier.id });
      if (error) throw error;
      setRecord({ ...record, registration_status: 'verified', sage_supplier_account: supplier.sage_code });
      onBlocked(false);
    } catch (err: any) { setError(err.message || 'Sage account could not be linked.'); }
    finally { setBusy(false); }
  };
  if (!record) return <div role="status" className="mb-3 rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">{error || 'Checking transporter registration...'}</div>;
  if (record.registration_status === 'not_required' || record.registration_status === 'legacy') return null;
  if (record.registration_status === 'verified') return <p className="mb-3 flex items-center gap-2 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" />Transporter linked: {record.transporter_name} - {record.sage_supplier_account}</p>;
  return <section className="mb-3 space-y-3 rounded-md border border-orange-300 bg-orange-50 p-4">
    <h3 className="flex items-center gap-2 text-sm font-bold text-orange-900"><AlertTriangle className="h-4 w-4 shrink-0" />New transporter - Finance action required</h3>
    <p className="text-sm font-semibold text-slate-900">{record.transporter_name || 'Transporter not recorded'}</p>
    {record.contact_phone && <p className="text-xs text-slate-700">Contact: {record.contact_phone}</p>}
    {record.registration_note && <p className="break-words text-xs text-slate-700">{record.registration_note}</p>}
    <p className="text-xs text-orange-900">Register or update this transporter in Sage, then link its imported supplier account before approving this GRN.</p>
    {canResolve && record.transporter_id && <>
      <div className="flex flex-wrap gap-2"><input aria-label="Sage transporter supplier code" value={account} onChange={event => { setAccount(event.target.value); setSupplier(null); }} placeholder="Sage supplier code" className="min-w-0 flex-1 rounded-md border border-orange-200 bg-white px-3 py-2 text-sm" /><button type="button" disabled={busy || !account.trim()} onClick={() => void findSupplier()} className="inline-flex items-center gap-2 rounded-md border border-orange-300 bg-white px-3 py-2 text-sm font-semibold"><Search className="h-4 w-4" />Find supplier</button></div>
      {supplier && <div className="space-y-2"><p className="text-sm font-semibold text-slate-900">{supplier.sage_code} - {supplier.name}</p><button type="button" disabled={busy} onClick={() => void resolve()} className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Confirm Sage supplier link</button></div>}
    </>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </section>;
}
