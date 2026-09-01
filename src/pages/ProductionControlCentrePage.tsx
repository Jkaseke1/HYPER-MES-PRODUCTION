import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Clock3, FileWarning, Plus, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import ProductionNoticeAttachments from '../components/production/ProductionNoticeAttachments';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { Link } from 'react-router-dom';

type Order = { id: string; batch_number: string; status: string; planned_qty: number; planned_end?: string; created_at: string; formulations?: { name?: string; sage_code?: string } | null };
type Notice = { id: string; production_order_id: string; output_qty_kg: number; output_bags: number; rejected_qty_kg: number; recycle_qty_kg: number; variance_reason: string; declaration_notes: string; status: string; submitted_at?: string; verified_at?: string };

const activeStatuses = ['materials_issued', 'in_progress', 'completed'];

export default function ProductionControlCentrePage() {
  const { profile } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [form, setForm] = useState({ outputQty: '', outputBags: '', rejectedQty: '0', recycleQty: '0', varianceReason: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const canVerify = ['admin', 'production_manager', 'supervisor', 'finance', 'accountant'].includes(profile?.role || '');

  const load = useCallback(async () => {
    const [orderResult, noticeResult] = await Promise.all([
      supabase.from('production_orders').select('id,batch_number,status,planned_qty,planned_end,created_at,formulations(name,sage_code)').in('status', activeStatuses).order('created_at', { ascending: false }).limit(100),
      supabase.from('production_notices').select('*').order('updated_at', { ascending: false }).limit(100),
    ]);
    if (orderResult.error || noticeResult.error) {
      toast.error(orderResult.error?.message || noticeResult.error?.message || 'Unable to load production controls');
      return;
    }
    setOrders((orderResult.data as Order[]) || []);
    setNotices((noticeResult.data as Notice[]) || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  useRealtimeRefresh('production-control-centre-live', ['production_orders', 'production_notices'], load);

  const noticeByOrder = useMemo(() => new Map(notices.map((notice) => [notice.production_order_id, notice])), [notices]);
  const overdueOrders = useMemo(() => orders.filter((order) => {
    const notice = noticeByOrder.get(order.id);
    if (notice?.status === 'verified') return false;
    return Date.now() - new Date(order.planned_end || order.created_at).getTime() > 24 * 60 * 60 * 1000;
  }), [orders, noticeByOrder]);

  const submitNotice = async () => {
    if (!profile?.id || !selectedOrderId) return toast.error('Select a production order first');
    const outputQty = Number(form.outputQty);
    const outputBags = Number(form.outputBags);
    if (!Number.isFinite(outputQty) || outputQty < 0 || !Number.isFinite(outputBags) || outputBags < 0) {
      return toast.error('Enter valid output kilograms and bags.');
    }
    setSaving(true);
    const payload = {
      production_order_id: selectedOrderId,
      output_qty_kg: outputQty,
      output_bags: outputBags,
      rejected_qty_kg: Number(form.rejectedQty || 0),
      recycle_qty_kg: Number(form.recycleQty || 0),
      variance_reason: form.varianceReason.trim(),
      declaration_notes: form.notes.trim(),
      status: 'submitted',
      submitted_by: profile.id,
      submitted_at: new Date().toISOString(),
      verified_by: null,
      verified_at: null,
      verification_notes: '',
    };
    const { error } = await supabase.from('production_notices').upsert(payload, { onConflict: 'production_order_id' });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Digital Production Notice submitted for verification.');
    setForm({ outputQty: '', outputBags: '', rejectedQty: '0', recycleQty: '0', varianceReason: '', notes: '' });
    setSelectedOrderId('');
    load();
  };

  const verify = async (notice: Notice) => {
    if (!profile?.id) return;
    const { error } = await supabase.from('production_notices').update({ status: 'verified', verified_by: profile.id, verified_at: new Date().toISOString() }).eq('id', notice.id);
    if (error) return toast.error(error.message);
    toast.success('Production Notice verified.');
    load();
  };

  return <div className="p-6 space-y-6">
    <div className="rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-teal-950 p-6 text-white">
      <div className="flex items-start gap-3"><div className="rounded-xl bg-teal-500/20 p-3"><ClipboardCheck className="h-7 w-7 text-teal-300" /></div><div><p className="text-xs font-bold tracking-[0.18em] text-teal-300">PRODUCTION ASSURANCE</p><h1 className="text-3xl font-extrabold">Production Control Centre</h1><p className="mt-1 text-slate-300">Digital notices, 24-hour exceptions and supervisor verification.</p></div></div>
    </div>

    <div className="grid gap-4 md:grid-cols-3">
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-5"><FileWarning className="h-5 w-5 text-rose-600" /><p className="mt-2 text-sm font-semibold text-rose-900">Overdue digital notices</p><p className="text-3xl font-bold text-rose-700">{overdueOrders.length}</p><p className="text-xs text-rose-700">More than 24 hours without verification</p></div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5"><Clock3 className="h-5 w-5 text-amber-600" /><p className="mt-2 text-sm font-semibold text-amber-900">Awaiting verification</p><p className="text-3xl font-bold text-amber-700">{notices.filter(n => n.status === 'submitted').length}</p><p className="text-xs text-amber-700">Supervisor or Finance review required</p></div>
      <Link to="/stock-take" className="rounded-xl border border-teal-200 bg-teal-50 p-5 transition hover:bg-teal-100"><ShieldCheck className="h-5 w-5 text-teal-600" /><p className="mt-2 text-sm font-semibold text-teal-900">Daily physical count</p><p className="mt-1 flex items-center gap-1 text-sm font-bold text-teal-700">Open Stock Take</p><p className="text-xs text-teal-700">Count, freeze, recount and approve variances.</p></Link>
    </div>

    <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
      <section className="rounded-xl border border-slate-200 bg-white p-5"><div className="mb-4 flex items-center gap-2"><Plus className="h-5 w-5 text-teal-600" /><h2 className="text-lg font-bold text-slate-900">Submit Digital Production Notice</h2></div>
        <div className="grid gap-3 md:grid-cols-2">
          <select value={selectedOrderId} onChange={e => setSelectedOrderId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 md:col-span-2"><option value="">Select production order</option>{orders.map(order => <option key={order.id} value={order.id}>{order.batch_number} - {order.formulations?.name || 'Production batch'} ({order.planned_qty} kg)</option>)}</select>
          <label className="space-y-1"><span className="text-xs font-semibold text-slate-700">Actual output (kg)</span><input type="number" min="0" placeholder="e.g. 1,200" value={form.outputQty} onChange={e => setForm({...form, outputQty:e.target.value})} className="w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="space-y-1"><span className="text-xs font-semibold text-slate-700">Actual output (bags)</span><input type="number" min="0" placeholder="e.g. 24" value={form.outputBags} onChange={e => setForm({...form, outputBags:e.target.value})} className="w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="space-y-1"><span className="text-xs font-semibold text-slate-700">Rejected or damaged quantity (kg)</span><input type="number" min="0" value={form.rejectedQty} onChange={e => setForm({...form, rejectedQty:e.target.value})} className="w-full rounded-lg border border-slate-300 px-3 py-2" /><span className="block text-[11px] text-slate-500">Stock that cannot be released as finished goods.</span></label>
          <label className="space-y-1"><span className="text-xs font-semibold text-slate-700">Approved recycle quantity (kg)</span><input type="number" min="0" value={form.recycleQty} onChange={e => setForm({...form, recycleQty:e.target.value})} className="w-full rounded-lg border border-slate-300 px-3 py-2" /><span className="block text-[11px] text-slate-500">Output approved to return for controlled rework.</span></label>
          <label className="space-y-1 md:col-span-2"><span className="text-xs font-semibold text-slate-700">Variance reason</span><input placeholder="Explain any difference from the planned batch" value={form.varianceReason} onChange={e => setForm({...form, varianceReason:e.target.value})} className="w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="space-y-1 md:col-span-2"><span className="text-xs font-semibold text-slate-700">Declaration and handover notes</span><textarea placeholder="Materials, output bags, exceptions and handover details" value={form.notes} onChange={e => setForm({...form, notes:e.target.value})} className="min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
        </div>
        <button disabled={saving} onClick={submitNotice} className="mt-4 rounded-lg bg-teal-600 px-4 py-2 font-semibold text-white hover:bg-teal-700 disabled:opacity-50">{saving ? 'Submitting...' : 'Submit for Verification'}</button>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-bold text-slate-900">Notice Register</h2><div className="mt-4 space-y-3">{notices.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No digital production notices yet.</p> : notices.map(notice => { const order = orders.find(o => o.id === notice.production_order_id); return <div key={notice.id} className="rounded-lg border border-slate-200 p-3"><div className="flex justify-between gap-3"><div><p className="font-bold text-slate-800">{order?.batch_number || 'Archived production order'}</p><p className="text-xs text-slate-500">{notice.output_qty_kg} kg / {notice.output_bags} bags · recycle {notice.recycle_qty_kg} kg</p></div><span className={`h-fit rounded-full px-2 py-1 text-xs font-bold ${notice.status === 'verified' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{notice.status}</span></div>{notice.status === 'submitted' && canVerify && <button onClick={() => verify(notice)} className="mt-3 flex items-center gap-1 text-sm font-semibold text-teal-700 hover:text-teal-900"><CheckCircle2 className="h-4 w-4" /> Verify notice</button>}{notice.status === 'submitted' && !canVerify && <p className="mt-3 text-xs text-slate-500">Awaiting supervisor or Finance verification.</p>}<ProductionNoticeAttachments noticeId={notice.id} /></div> })}</div></section>
    </div>
  </div>;
}
