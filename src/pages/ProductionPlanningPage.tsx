import { useState, useEffect, useCallback } from 'react';
import { Plus, ClipboardList, Calendar, CreditCard as Edit2, Eye, Check, Play, Search, TrendingUp, CheckCircle2, BarChart2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Modal from '../components/ui/Modal';
import StatusBadge from '../components/ui/StatusBadge';
import type { ProductionPlan, ProductionPlanItem, Formulation } from '../types/database';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

type Tab = 'all' | 'draft' | 'confirmed' | 'in_progress' | 'completed';
type PlanWithCount = ProductionPlan & { item_count: number };
interface DraftItem { formulation_id: string; planned_qty: number; unit: string; priority: number; notes: string }

const emptyItem = (): DraftItem => ({ formulation_id: '', planned_qty: 0, unit: 'kg', priority: 1, notes: '' });

export default function ProductionPlanningPage() {
  const [plans, setPlans] = useState<PlanWithCount[]>([]);
  const [allPlans, setAllPlans] = useState<PlanWithCount[]>([]);
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [formulations, setFormulations] = useState<Pick<Formulation, 'id' | 'name' | 'code'>[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [viewPlan, setViewPlan] = useState<ProductionPlan | null>(null);
  const [viewItems, setViewItems] = useState<ProductionPlanItem[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ plan_number: '', plan_date: '', start_date: '', end_date: '', notes: '' });
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [loading, setLoading] = useState(false);

  const fetchPlans = useCallback(async () => {
    let q = supabase.from('production_plans').select('*, production_plan_items(id, formulation_id, planned_qty)').order('created_at', { ascending: false });
    if (tab !== 'all') q = q.eq('status', tab);
    if (search) q = q.ilike('plan_number', `%${search}%`);
    const { data } = await q;
    if (data) {
      const mapped = data.map((p: any) => ({ ...p, item_count: p.production_plan_items?.length ?? 0 }));
      setPlans(mapped);
      if (tab === 'all' && !search) setAllPlans(mapped);
    }
  }, [tab, search]);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);
  useEffect(() => {
    supabase.from('formulations').select('id, name, code').eq('status', 'active').then(({ data }) => { if (data) setFormulations(data); });
  }, []);

  async function generatePlanNumber() {
    const year = new Date().getFullYear();
    const { count } = await supabase.from('production_plans').select('id', { count: 'exact', head: true }).ilike('plan_number', `PLN-${year}-%`);
    return `PLN-${year}-${String((count ?? 0) + 1).padStart(3, '0')}`;
  }

  async function openCreate() {
    const num = await generatePlanNumber();
    const today = new Date().toISOString().slice(0, 10);
    setEditId(null);
    setForm({ plan_number: num, plan_date: today, start_date: today, end_date: '', notes: '' });
    setItems([emptyItem()]);
    setModalOpen(true);
  }

  async function openEdit(plan: ProductionPlan) {
    setEditId(plan.id);
    setForm({ plan_number: plan.plan_number, plan_date: plan.plan_date, start_date: plan.start_date, end_date: plan.end_date, notes: plan.notes });
    const { data } = await supabase.from('production_plan_items').select('*').eq('plan_id', plan.id);
    setItems(data && data.length > 0 ? data.map((i: any) => ({ formulation_id: i.formulation_id, planned_qty: i.planned_qty, unit: i.unit, priority: i.priority, notes: i.notes })) : [emptyItem()]);
    setModalOpen(true);
  }

  async function openView(plan: ProductionPlan) {
    setViewPlan(plan);
    const { data } = await supabase.from('production_plan_items').select('*, formulations(id, name, code, batch_unit)').eq('plan_id', plan.id);
    setViewItems(data ?? []);
  }

  async function handleSave() {
    setLoading(true);
    const payload = { plan_number: form.plan_number, plan_date: form.plan_date, start_date: form.start_date, end_date: form.end_date, notes: form.notes, status: 'draft' as const };
    let planId = editId;
    if (editId) {
      const { plan_number: _pn, status: _s, ...updates } = payload;
      await supabase.from('production_plans').update(updates).eq('id', editId);
      await supabase.from('production_plan_items').delete().eq('plan_id', editId);
    } else {
      const { data } = await supabase.from('production_plans').insert(payload).select('id').single();
      planId = data?.id ?? null;
    }
    if (planId) {
      const validItems = items.filter(i => i.formulation_id && i.planned_qty > 0);
      if (validItems.length) await supabase.from('production_plan_items').insert(validItems.map(i => ({ ...i, plan_id: planId })));
    }
    setModalOpen(false);
    setLoading(false);
    fetchPlans();
  }

  async function updateStatus(id: string, status: ProductionPlan['status']) {
    await supabase.from('production_plans').update({ status }).eq('id', id);
    fetchPlans();
    if (viewPlan?.id === id) setViewPlan({ ...viewPlan!, status });
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'draft', label: 'Draft' }, { key: 'confirmed', label: 'Confirmed' },
    { key: 'in_progress', label: 'In Progress' }, { key: 'completed', label: 'Completed' },
  ];

  const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500';

  const totalPlans = allPlans.length;
  const activePlans = allPlans.filter(p => p.status === 'in_progress').length;
  const completedPlans = allPlans.filter(p => p.status === 'completed').length;
  const completionRate = totalPlans > 0 ? Math.round((completedPlans / totalPlans) * 100) : 0;

  const forecastData = formulations.slice(0, 6).map(f => ({
    name: f.code,
    Planned: allPlans.filter(p => p.status !== 'completed').reduce((s: number, p: any) => s + ((p.production_plan_items || []).filter((i: any) => i.formulation_id === f.id).reduce((ss: number, i: any) => ss + (i.planned_qty || 0), 0)), 0),
    Completed: allPlans.filter(p => p.status === 'completed').reduce((s: number, p: any) => s + ((p.production_plan_items || []).filter((i: any) => i.formulation_id === f.id).reduce((ss: number, i: any) => ss + (i.planned_qty || 0), 0)), 0),
  }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-teal-100 rounded-xl flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-teal-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Production Planning</h1>
            <p className="text-sm text-slate-500">Manage production schedules and plans</p>
          </div>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold transition-colors">
          <Plus className="w-4 h-4" /> New Plan
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Plans', value: totalPlans, icon: ClipboardList, color: 'bg-teal-50 text-teal-600' },
          { label: 'In Progress', value: activePlans, icon: TrendingUp, color: 'bg-amber-50 text-amber-600' },
          { label: 'Completed', value: completedPlans, icon: CheckCircle2, color: 'bg-emerald-50 text-emerald-600' },
          { label: 'Completion Rate', value: `${completionRate}%`, icon: BarChart2, color: 'bg-teal-50 text-teal-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${color}`}><Icon className="w-5 h-5" /></div>
              <div>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-xl font-bold text-slate-800">{value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Demand Forecast Chart */}
      {forecastData.some(d => d.Planned > 0 || d.Completed > 0) && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 className="w-4 h-4 text-teal-600" />
            <h3 className="text-sm font-semibold text-slate-700">Demand Forecast — Planned vs Completed (by Formulation)</h3>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={forecastData} barSize={18} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Planned" fill="#0d9488" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Completed" fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex bg-slate-100 rounded-lg p-1 gap-0.5">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === t.key ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search plans..." className="pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 w-64" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>{['Plan Number', 'Plan Date', 'Start', 'End', 'Status', 'Items', 'Actions'].map(h => (
              <th key={h} className="text-left px-4 py-3 font-semibold text-slate-600">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {plans.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">No production plans found</td></tr>}
            {plans.map(p => (
              <tr key={p.id} onClick={() => openView(p)} className="hover:bg-slate-50 cursor-pointer transition-colors">
                <td className="px-4 py-3 font-medium text-slate-800">{p.plan_number}</td>
                <td className="px-4 py-3 text-slate-600">{p.plan_date}</td>
                <td className="px-4 py-3 text-slate-600">{p.start_date}</td>
                <td className="px-4 py-3 text-slate-600">{p.end_date}</td>
                <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                <td className="px-4 py-3 text-slate-600">{p.item_count}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <button onClick={() => openView(p)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-teal-600"><Eye className="w-4 h-4" /></button>
                    {p.status === 'draft' && <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-teal-600"><Edit2 className="w-4 h-4" /></button>}
                    {p.status === 'draft' && <button onClick={() => updateStatus(p.id, 'confirmed')} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-emerald-600"><Check className="w-4 h-4" /></button>}
                    {p.status === 'confirmed' && <button onClick={() => updateStatus(p.id, 'in_progress')} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-teal-600"><Play className="w-4 h-4" /></button>}
                    {p.status === 'in_progress' && <button onClick={() => updateStatus(p.id, 'completed')} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-emerald-600"><Check className="w-4 h-4" /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editId ? 'Edit Production Plan' : 'New Production Plan'}
        size="xl"
        footer={
          <div className="flex justify-end gap-3">
            <button onClick={() => setModalOpen(false)} className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={loading} className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50">
              {loading ? 'Saving...' : 'Save Plan'}
            </button>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Plan Number</label>
              <input value={form.plan_number} readOnly className={`${inputCls} bg-slate-50 text-slate-500`} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Plan Date *</label>
              <input type="date" value={form.plan_date} onChange={e => setForm({ ...form, plan_date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Start Date *</label>
              <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">End Date</label>
              <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} className={inputCls} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Optional notes..." className={`${inputCls} resize-none`} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-slate-700">Plan Items</h4>
              <button onClick={() => setItems([...items, emptyItem()])} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-600 border border-teal-200 rounded-lg hover:bg-teal-50 transition-colors">
                <Plus className="w-3.5 h-3.5" /> Add Item
              </button>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-3 items-start p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="col-span-4">
                    <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">Formulation</label>
                    <select value={item.formulation_id} onChange={e => { const n = [...items]; n[idx].formulation_id = e.target.value; setItems(n); }} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white">
                      <option value="">Select Finance-Activated formulation for today's run...</option>
                      {(() => {
                        const activeIds: string[] = JSON.parse(localStorage.getItem('daily_active_formulations') || '[]');
                        const activeList = formulations.filter(f => activeIds.includes(f.id) || (f as any).is_daily_active === true);
                        return (activeList.length > 0 ? activeList : formulations).map(f => (
                          <option key={f.id} value={f.id}>✨ {f.code} — {f.name} (v{f.version})</option>
                        ));
                      })()}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">Qty</label>
                    <input type="number" min={0} value={item.planned_qty} onChange={e => { const n = [...items]; n[idx].planned_qty = +e.target.value; setItems(n); }} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white" />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">Unit</label>
                    <input value={item.unit} onChange={e => { const n = [...items]; n[idx].unit = e.target.value; setItems(n); }} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">Priority</label>
                    <input type="number" min={1} value={item.priority} onChange={e => { const n = [...items]; n[idx].priority = +e.target.value; setItems(n); }} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">Notes</label>
                    <input value={item.notes} placeholder="Optional" onChange={e => { const n = [...items]; n[idx].notes = e.target.value; setItems(n); }} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white" />
                  </div>
                  <div className="col-span-1 flex justify-center pt-[26px]">
                    {items.length > 1 && (
                      <button onClick={() => setItems(items.filter((_, i) => i !== idx))} className="w-7 h-7 rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-red-500 hover:border-red-200 text-xs font-medium transition-colors">✕</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <Modal open={!!viewPlan} onClose={() => setViewPlan(null)} title="Plan Details" size="lg">
        {viewPlan && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><span className="text-xs text-slate-500">Plan Number</span><p className="font-medium text-slate-800">{viewPlan.plan_number}</p></div>
              <div><span className="text-xs text-slate-500">Status</span><div className="mt-0.5"><StatusBadge status={viewPlan.status} /></div></div>
              <div className="flex items-center gap-1.5"><Calendar className="w-4 h-4 text-slate-400" /><div><span className="text-xs text-slate-500">Plan Date</span><p className="text-sm text-slate-700">{viewPlan.plan_date}</p></div></div>
              <div className="flex items-center gap-1.5"><Calendar className="w-4 h-4 text-slate-400" /><div><span className="text-xs text-slate-500">Period</span><p className="text-sm text-slate-700">{viewPlan.start_date} to {viewPlan.end_date}</p></div></div>
            </div>
            {viewPlan.notes && <div className="p-3 bg-slate-50 rounded-lg text-sm text-slate-600">{viewPlan.notes}</div>}
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-2">Plan Items ({viewItems.length})</h4>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50"><tr>
                    {['Formulation', 'Planned Qty', 'Unit', 'Priority', 'Notes'].map(h => <th key={h} className="text-left px-4 py-2 font-medium text-slate-600 text-xs">{h}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {viewItems.map(i => (
                      <tr key={i.id}>
                        <td className="px-4 py-2 font-medium text-slate-800">{i.formulations ? `${i.formulations.code} - ${i.formulations.name}` : '-'}</td>
                        <td className="px-4 py-2 text-slate-600">{i.planned_qty.toLocaleString()}</td>
                        <td className="px-4 py-2 text-slate-600">{i.unit}</td>
                        <td className="px-4 py-2 text-slate-600">{i.priority}</td>
                        <td className="px-4 py-2 text-slate-500">{i.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              {viewPlan.status === 'draft' && <button onClick={() => updateStatus(viewPlan.id, 'confirmed')} className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold transition-colors"><Check className="w-4 h-4" /> Confirm</button>}
              {viewPlan.status === 'confirmed' && <button onClick={() => updateStatus(viewPlan.id, 'in_progress')} className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold transition-colors"><Play className="w-4 h-4" /> Start</button>}
              {viewPlan.status === 'in_progress' && <button onClick={() => updateStatus(viewPlan.id, 'completed')} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition-colors"><Check className="w-4 h-4" /> Complete</button>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
