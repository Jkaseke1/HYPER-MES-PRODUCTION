import { useEffect, useState } from 'react';
import { ClipboardList, Plus, FileText, ShieldCheck, Landmark, Search, Wrench } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

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
  const [form, setForm] = useState({ title: '', business_reason: '', priority: 'normal', required_by: '', description: '', quantity: '1', unit: 'each' });
  const canCreate = ['admin', 'md', 'maintenance_tech', 'procurement'].includes(profile?.role || '');

  const load = async () => {
    const { data, error } = await supabase.from('maintenance_procurement_requests').select('*, maintenance_procurement_quotes(count), maintenance_procurement_sage_history(count)').order('created_at', { ascending: false });
    if (error) { toast.error(`Could not load procurement requests: ${error.message}`); return; }
    setRequests((data || []) as Request[]);
  };
  useEffect(() => { void load(); }, []);

  const createRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim() || !form.business_reason.trim() || !form.description.trim() || Number(form.quantity) <= 0) { toast.error('Complete the request, business reason, and item details.'); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase.from('maintenance_procurement_requests').insert({ title: form.title.trim(), business_reason: form.business_reason.trim(), priority: form.priority, required_by: form.required_by || null, created_by: profile?.id, plantcontrol_reference: '', request_number: '' }).select('id').single();
      if (error) throw error;
      const { error: itemError } = await supabase.from('maintenance_procurement_items').insert({ request_id: data.id, line_number: 1, description: form.description.trim(), quantity: Number(form.quantity), unit: form.unit.trim() || 'each' });
      if (itemError) throw itemError;
      toast.success('Maintenance procurement request created. Add quotations before approval.');
      setForm({ title: '', business_reason: '', priority: 'normal', required_by: '', description: '', quantity: '1', unit: 'each' }); setShowForm(false); await load();
    } catch (error: any) { toast.error(error.message || 'Could not create procurement request.'); } finally { setSaving(false); }
  };

  const visible = requests.filter(r => `${r.request_number} ${r.title} ${r.selected_supplier_name || ''}`.toLowerCase().includes(search.toLowerCase()));
  const awaitingApproval = requests.filter(r => r.status === 'pending_approval').length;
  const open = requests.filter(r => !['paid', 'cancelled', 'rejected'].includes(r.status)).length;

  return <div className="min-h-[calc(100vh-4rem)] bg-slate-50 p-4 md:p-6"><div className="mx-auto max-w-[1500px] space-y-5">
    <section className="overflow-hidden rounded-lg border border-slate-900 bg-slate-900 text-white shadow-lg"><div className="flex flex-col justify-between gap-5 px-6 py-6 md:flex-row md:items-center"><div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-300"><Wrench className="h-4 w-4" /> Maintenance control</div><h1 className="mt-3 text-2xl font-bold">Maintenance Procurement</h1><p className="mt-1 text-sm text-slate-300">Requests, quote comparison, approval, evidence, and read-only Sage payment reconciliation.</p></div>{canCreate && <button onClick={() => setShowForm(!showForm)} className="inline-flex h-11 items-center justify-center gap-2 bg-[#f39200] px-4 text-sm font-bold hover:bg-[#dc8500]"><Plus className="h-5 w-5" /> New request</button>}</div><div className="grid border-t border-white/10 sm:grid-cols-3"><div className="border-r border-white/10 px-6 py-4"><p className="text-xs font-bold uppercase text-slate-400">Register</p><p className="mt-1 text-3xl font-bold">{requests.length}</p></div><div className="border-r border-white/10 px-6 py-4"><p className="text-xs font-bold uppercase text-slate-400">Open workflow</p><p className="mt-1 text-3xl font-bold text-cyan-300">{open}</p></div><div className="px-6 py-4"><p className="text-xs font-bold uppercase text-slate-400">Awaiting approval</p><p className="mt-1 text-3xl font-bold text-amber-300">{awaitingApproval}</p></div></div></section>
    {showForm && <form onSubmit={createRequest} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2"><h2 className="col-span-full text-base font-bold text-slate-900">New maintenance request</h2><input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Request title" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option><option value="low">Low</option></select><textarea required value={form.business_reason} onChange={e => setForm({ ...form, business_reason: e.target.value })} placeholder="Business reason and maintenance impact" className="min-h-20 rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2" /><input required value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Item / specification" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><div className="grid grid-cols-3 gap-2"><input type="number" min="0.001" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="Unit" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input type="date" value={form.required_by} onChange={e => setForm({ ...form, required_by: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm" /></div><div className="col-span-full flex justify-end gap-2"><button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button><button disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{saving ? 'Saving...' : 'Create request'}</button></div></form>}
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-200 p-4"><div><h2 className="font-bold text-slate-900">Procurement register</h2><p className="text-xs text-slate-500">Sage payment status appears only after read-only reconciliation.</p></div><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search request or supplier" className="rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm"/></div></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Request</th><th className="px-4 py-3">Purpose</th><th className="px-4 py-3">Quotes</th><th className="px-4 py-3">Workflow</th><th className="px-4 py-3">Sage check</th></tr></thead><tbody className="divide-y divide-slate-100">{visible.map(r => <tr key={r.id} className="hover:bg-slate-50"><td className="px-4 py-3"><p className="font-mono font-bold text-slate-900">{r.plantcontrol_reference}</p><p className="text-xs text-slate-500">{r.title}</p></td><td className="max-w-md px-4 py-3 text-slate-600">{r.business_reason}</td><td className="px-4 py-3"><span className="inline-flex items-center gap-1 text-xs font-bold text-slate-700"><FileText className="h-4 w-4 text-violet-600" />{r.maintenance_procurement_quotes?.[0]?.count || 0} uploaded</span></td><td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusStyle[r.status] || statusStyle.draft}`}>{r.status.replace('_', ' ')}</span></td><td className="px-4 py-3"><span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500"><Landmark className="h-4 w-4" />{(r.maintenance_procurement_sage_history?.[0]?.count || 0) ? 'Imported transactions' : 'Not reconciled'}</span></td></tr>)}{visible.length === 0 && <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400"><ClipboardList className="mx-auto mb-2 h-8 w-8"/>No procurement requests yet.</td></tr>}</tbody></table></div></section>
  </div></div>;
}
