import { useEffect, useRef, useState } from 'react';
import { ClipboardList, Plus, FileText, Landmark, Search, Wrench } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { validateProcurementIntake } from '../lib/procurementIntake';
import { loadProcurementAttempt, saveProcurementDraft } from '../lib/procurementDraft';
import { loadProcurementDetails, type ProcurementDetails } from '../lib/procurementDetails';
import ProcurementRequestDetails from '../components/procurement/ProcurementRequestDetails';

type Request = { id: string; request_number: string; title: string; business_reason: string; priority: string; required_by?: string; status: string; currency_code: string; approved_amount?: number; selected_supplier_name?: string; plantcontrol_reference: string; created_at: string; maintenance_procurement_quotes?: { count: number }[]; maintenance_procurement_sage_history?: { count: number }[] };

const statusStyle: Record<string, string> = {
  draft: 'border-slate-200 bg-slate-50 text-slate-700', submitted: 'border-blue-200 bg-blue-50 text-blue-800', quoting: 'border-violet-200 bg-violet-50 text-violet-800', pending_approval: 'border-amber-200 bg-amber-50 text-amber-800', approved: 'border-emerald-200 bg-emerald-50 text-emerald-800', po_issued: 'border-cyan-200 bg-cyan-50 text-cyan-800', received: 'border-teal-200 bg-teal-50 text-teal-800', part_paid: 'border-orange-200 bg-orange-50 text-orange-800', paid: 'border-emerald-200 bg-emerald-50 text-emerald-800', rejected: 'border-rose-200 bg-rose-50 text-rose-800', cancelled: 'border-slate-200 bg-slate-100 text-slate-500',
};

export default function MaintenanceProcurementPage() {
  const { profile } = useAuth();
  const [requests, setRequests] = useState<Request[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveInProgress = useRef(false);
  const [pendingRecovery, setPendingRecovery] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsRefresh, setDetailsRefresh] = useState(0);
  const [registerError, setRegisterError] = useState('');
  const [detailState, setDetailState] = useState<{
    requestId: string; data: ProcurementDetails | null; loading: boolean; error: string;
  } | null>(null);
  const [form, setForm] = useState({ title: '', business_reason: '', priority: 'normal', required_by: '', description: '', quantity: '1', unit: 'each' });
  const canCreate = ['admin', 'maintenance_tech', 'procurement'].includes(profile?.role || '');

  const load = async () => {
    try {
      const { data, error } = await supabase.from('maintenance_procurement_requests').select('id,request_number,title,business_reason,priority,required_by,status,currency_code,approved_amount,selected_supplier_name,plantcontrol_reference,created_at,maintenance_procurement_quotes(count),maintenance_procurement_sage_history(count)').order('created_at', { ascending: false });
      if (error) throw error;
      setRequests((data || []) as Request[]);
      setRegisterError('');
    } catch {
      setRegisterError('Could not refresh the register. The displayed list may be out of date.');
    }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    setPendingRecovery(false); setRecoveryError(''); setSavedId(null); setSelectedId(null);
    setShowForm(false);
    setForm({ title: '', business_reason: '', priority: 'normal', required_by: '', description: '', quantity: '1', unit: 'each' });
    if (!profile?.id) return;
    try {
      const attempt = loadProcurementAttempt(sessionStorage, profile.id);
      if (attempt) { setForm(attempt.payload); setShowForm(true); setPendingRecovery(true); }
    } catch (error) { setRecoveryError(error instanceof Error ? error.message : 'Could not restore pending request.'); }
  }, [profile?.id]);
  useEffect(() => {
    if (!selectedId) { setDetailState(null); return; }
    let active = true;
    setDetailState({ requestId: selectedId, data: null, loading: true, error: '' });
    void loadProcurementDetails(supabase, selectedId).then(data => {
      if (active) setDetailState({ requestId: selectedId, data, loading: false, error: '' });
    }).catch((error: unknown) => {
      if (active) setDetailState({ requestId: selectedId, data: null, loading: false, error: error instanceof Error ? error.message : 'Could not load all request details. Retry to view the complete record.' });
    });
    return () => { active = false; };
  }, [selectedId, detailsRefresh]);

  const createRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saveInProgress.current) return;
    if (recoveryError) { toast.error(recoveryError); return; }
    if (!canCreate || !profile?.id) { toast.error('Sign in with request creation access.'); return; }
    const validationError = validateProcurementIntake(form);
    if (validationError) { toast.error(validationError); return; }
    saveInProgress.current = true;
    setSaving(true);
    try {
      const id = await saveProcurementDraft(supabase, sessionStorage, profile.id, form, () => crypto.randomUUID());
      setSavedId(id); setSelectedId(id); setPendingRecovery(false);
      toast.success('Request save confirmed.');
      setForm({ title: '', business_reason: '', priority: 'normal', required_by: '', description: '', quantity: '1', unit: 'each' }); setShowForm(false); await load();
    } catch (error) {
      try {
        const attempt = loadProcurementAttempt(sessionStorage, profile.id);
        if (attempt) { setForm(attempt.payload); setShowForm(true); setPendingRecovery(true); }
      } catch { setRecoveryError('Could not restore the pending request. Check the register before starting another.'); }
      toast.error(error instanceof Error ? error.message : 'Could not confirm request creation. Retry the same details.');
    } finally { saveInProgress.current = false; setSaving(false); }
  };

  const visible = requests.filter(r => `${r.request_number} ${r.title} ${r.selected_supplier_name || ''}`.toLowerCase().includes(search.toLowerCase()));
  const awaitingApproval = requests.filter(r => r.status === 'pending_approval').length;
  const open = requests.filter(r => !['paid', 'cancelled', 'rejected'].includes(r.status)).length;
  const savedRequest = requests.find(request => request.id === savedId);
  const selectedRequest = requests.find(request => request.id === selectedId);

  return <div className="min-h-[calc(100vh-4rem)] bg-slate-50 p-4 md:p-6"><div className="mx-auto max-w-[1500px] space-y-5">
    {savedId && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <p className="font-bold">{savedRequest ? `Request ${savedRequest.plantcontrol_reference} saved.` : 'Request save confirmed. Refresh the register to see its reference.'}</p>
      <p className="mt-1">Keep this reference with the original quotes, invoices and service records.</p>
    </div>}
    {pendingRecovery && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-bold">A previous save is unconfirmed.</p><p className="mt-1">Your original details are restored. Confirm the previous save before starting another request.</p>
      {!showForm && <button type="button" onClick={() => setShowForm(true)} className="mt-2 font-bold underline">Show pending request</button>}
    </div>}
    {recoveryError && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{recoveryError}</div>}
    {registerError && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{registerError} <button type="button" onClick={() => void load()} className="ml-2 font-bold underline">Refresh register</button></div>}
    {selectedId && <ProcurementRequestDetails
      reference={selectedRequest?.plantcontrol_reference || 'Saved request'} title={selectedRequest?.title || ''}
      details={detailState?.requestId === selectedId ? detailState.data : null}
      loading={detailState?.requestId !== selectedId || detailState.loading}
      error={detailState?.requestId === selectedId ? detailState.error : ''}
      onRetry={() => setDetailsRefresh(value => value + 1)} onClose={() => setSelectedId(null)}
    />}
    <section className="overflow-hidden rounded-lg border border-slate-900 bg-slate-900 text-white shadow-lg"><div className="flex flex-col justify-between gap-5 px-6 py-6 md:flex-row md:items-center"><div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-300"><Wrench className="h-4 w-4" /> Maintenance control</div><h1 className="mt-3 text-2xl font-bold">Maintenance Procurement</h1><p className="mt-1 text-sm text-slate-300">Requests, quote comparison, approval, evidence, and read-only Sage payment reconciliation.</p></div>{canCreate && <button disabled={saving || !!recoveryError} onClick={() => setShowForm(!showForm)} className="inline-flex h-11 items-center justify-center gap-2 bg-[#f39200] px-4 text-sm font-bold hover:bg-[#dc8500]"><Plus className="h-5 w-5" /> {pendingRecovery ? 'Pending request' : 'New request'}</button>}</div><div className="grid border-t border-white/10 sm:grid-cols-3"><div className="border-r border-white/10 px-6 py-4"><p className="text-xs font-bold uppercase text-slate-400">Register</p><p className="mt-1 text-3xl font-bold">{requests.length}</p></div><div className="border-r border-white/10 px-6 py-4"><p className="text-xs font-bold uppercase text-slate-400">Open workflow</p><p className="mt-1 text-3xl font-bold text-cyan-300">{open}</p></div><div className="px-6 py-4"><p className="text-xs font-bold uppercase text-slate-400">Awaiting approval</p><p className="mt-1 text-3xl font-bold text-amber-300">{awaitingApproval}</p></div></div></section>
    {showForm && <form onSubmit={createRequest} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2"><h2 className="col-span-full text-base font-bold text-slate-900">{pendingRecovery ? 'Confirm previous request' : 'New maintenance request'}</h2><fieldset disabled={saving || pendingRecovery || !!recoveryError} className="contents"><input required aria-label="Request title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Request title" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><select aria-label="Priority" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option><option value="low">Low</option></select><textarea required aria-label="Business reason" value={form.business_reason} onChange={e => setForm({ ...form, business_reason: e.target.value })} placeholder="Business reason and maintenance impact" className="min-h-20 rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2" /><input required aria-label="Item or service specification" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Item / specification" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><div className="grid grid-cols-3 gap-2"><input aria-label="Quantity" type="number" min="0.001" step="0.001" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input aria-label="Unit" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="Unit" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input aria-label="Required by" type="date" value={form.required_by} onChange={e => setForm({ ...form, required_by: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm" /></div></fieldset><div className="col-span-full flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-semibold text-slate-600">Close</button><button disabled={saving || !!recoveryError} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{saving ? 'Saving...' : pendingRecovery ? 'Confirm previous save' : 'Create request'}</button></div></form>}
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-200 p-4"><div><h2 className="font-bold text-slate-900">Procurement register</h2><p className="text-xs text-slate-500">Imported accounting records do not confirm bank settlement.</p></div><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search request or supplier" className="rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm"/></div></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Request</th><th className="px-4 py-3">Purpose</th><th className="px-4 py-3">Quotes</th><th className="px-4 py-3">Workflow</th><th className="px-4 py-3">Sage check</th></tr></thead><tbody className="divide-y divide-slate-100">{visible.map(r => <tr key={r.id} className="hover:bg-slate-50"><td className="px-4 py-3"><button type="button" onClick={() => setSelectedId(r.id)} aria-expanded={selectedId === r.id} aria-controls="procurement-request-details" className="font-mono font-bold text-teal-800 underline hover:text-teal-600">{r.plantcontrol_reference}</button><p className="text-xs text-slate-500">{r.title}</p></td><td className="max-w-md px-4 py-3 text-slate-600">{r.business_reason}</td><td className="px-4 py-3"><span className="inline-flex items-center gap-1 text-xs font-bold text-slate-700"><FileText className="h-4 w-4 text-violet-600" />{r.maintenance_procurement_quotes?.[0]?.count || 0} quote records</span></td><td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusStyle[r.status] || statusStyle.draft}`}>{r.status === 'paid' ? 'Paid in Sage' : r.status === 'part_paid' ? 'Part paid in Sage' : r.status.replace(/_/g, ' ')}</span></td><td className="px-4 py-3"><span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500"><Landmark className="h-4 w-4" />{(r.maintenance_procurement_sage_history?.[0]?.count || 0) ? 'Imported transactions' : 'Not reconciled'}</span></td></tr>)}{visible.length === 0 && <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400"><ClipboardList className="mx-auto mb-2 h-8 w-8"/>No procurement requests yet.</td></tr>}</tbody></table></div></section>
  </div></div>;
}
