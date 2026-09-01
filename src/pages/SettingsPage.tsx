import { useState, useEffect, useCallback } from 'react';
import { Plus, CreditCard as Edit2, Trash2, Building2, Warehouse as WarehouseIcon, Cog, Users, MapPin, Search, DollarSign } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/ui/Modal';
import StatusBadge from '../components/ui/StatusBadge';
import type { Branch, Warehouse, Machine, Supplier, Formulation } from '../types/database';

type Tab = 'branches' | 'warehouses' | 'machines' | 'suppliers' | 'cost_rates' | 'profile';
const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'branches', label: 'Branches', icon: Building2 },
  { key: 'warehouses', label: 'Warehouses', icon: WarehouseIcon },
  { key: 'machines', label: 'Machines', icon: Cog },
  { key: 'suppliers', label: 'Suppliers', icon: Users },
  { key: 'cost_rates', label: 'Cost Rates', icon: DollarSign },
  { key: 'profile', label: 'Profile', icon: MapPin },
];

const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none';
const btnPrimary = 'bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors';
const btnSecondary = 'border border-slate-300 text-slate-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors';
const thCls = 'px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider';
const tdCls = 'px-4 py-3 text-sm text-slate-700';

function ActiveDot({ active }: { active: boolean }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-300'}`} />;
}

export default function SettingsPage() {
  const { user, profile: authProfile } = useAuth();
  const [tab, setTab] = useState<Tab>('branches');
  const [search, setSearch] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [profileForm, setProfileForm] = useState({ full_name: '', phone: '' });
  const [labourRates, setLabourRates] = useState<Record<string, number>>({}); // formulation_id -> rate per tonne
  const [formulations, setFormulations] = useState<Formulation[]>([]);
  const [rateSearch, setRateSearch] = useState<string>('');
  const [overheadPctInput, setOverheadPctInput] = useState<string>('5');
  const [usdZigRate, setUsdZigRate] = useState<number | null>(null);
  const [rateSaving, setRateSaving] = useState(false);
  const [rateSavedAt, setRateSavedAt] = useState<number | null>(null);
  const [modal, setModal] = useState<{ type: 'add' | 'edit'; tab: Tab; data?: any } | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (t: Tab) => {
    if (t === 'branches') {
      const { data } = await supabase.from('branches').select('*').order('name');
      setBranches(data || []);
    } else if (t === 'warehouses') {
      const { data } = await supabase.from('warehouses').select('*, branches(name)').order('name');
      setWarehouses(data || []);
    } else if (t === 'machines') {
      const { data } = await supabase.from('machines').select('*').order('name');
      setMachines(data || []);
    } else if (t === 'suppliers') {
      const { data } = await supabase.from('suppliers').select('*').order('name');
      setSuppliers(data || []);
    } else if (t === 'cost_rates') {
      const [formulationsRes, ratesRes, settingsRes, fxRes] = await Promise.all([
        supabase.from('formulations').select('id, name, code, sage_code, category, status').eq('status', 'active').order('sage_code'),
        supabase.from('labour_rates').select('formulation_id, rate_per_tonne_usd, effective_date').order('effective_date', { ascending: false }),
        supabase.from('cost_settings').select('value').eq('key', 'overhead_rate_percent').maybeSingle(),
        supabase.from('usd_zig_rate_history').select('rate').order('effective_date', { ascending: false }).limit(1).maybeSingle(),
      ]);
      setFormulations((formulationsRes.data as Formulation[]) || []);
      const latest: Record<string, number> = {};
      (ratesRes.data || []).forEach((r: any) => {
        if (latest[r.formulation_id] === undefined) latest[r.formulation_id] = Number(r.rate_per_tonne_usd);
      });
      setLabourRates(latest);
      setOverheadPctInput(String(settingsRes.data?.value ?? 5));
      setUsdZigRate(fxRes.data?.rate ? Number(fxRes.data.rate) : null);
    } else if (t === 'profile' && authProfile) {
      setProfileForm({ full_name: authProfile.full_name || '', phone: authProfile.phone || '' });
    }
  }, [authProfile]);

  useEffect(() => { load(tab); }, [tab, load]);

  useEffect(() => {
    if (tab === 'warehouses' && !branches.length) {
      supabase.from('branches').select('*').order('name').then(({ data }) => setBranches(data || []));
    }
  }, [tab, branches.length]);

  function openAdd() {
    const defaults: Record<Tab, Record<string, any>> = {
      branches: { name: '', code: '', sage_code: '', sage_warehouse_code: '', sage_warehouse_id: '', address: '', contact_person: '', phone: '', is_active: true },
      warehouses: { name: '', code: '', type: 'raw_material', branch_id: '', location: '', sage_warehouse_code: '', sage_warehouse_id: '', is_active: true },
      machines: { name: '', code: '', type: '', capacity_per_hour: 0, capacity_unit: 'kg', status: 'operational' },
      suppliers: { name: '', code: '', sage_code: '', contact_person: '', email: '', phone: '', address: '', payment_terms: '', is_active: true },
      cost_rates: {},
      profile: {},
    };
    setForm(defaults[tab]);
    setModal({ type: 'add', tab });
  }

  function openEdit(item: any) {
    setForm({ ...item });
    setModal({ type: 'edit', tab, data: item });
  }

  async function handleSave() {
    setSaving(true);
    const table = tab;
    if (modal?.type === 'add') {
      const { created_at, updated_at, id, branches: _b, ...rest } = form;
      await supabase.from(table).insert(rest);
    } else if (modal?.type === 'edit') {
      const { created_at, updated_at, branches: _b, ...rest } = form;
      await supabase.from(table).update(rest).eq('id', form.id);
    }
    setSaving(false);
    setModal(null);
    load(tab);
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this record?')) return;
    await supabase.from(tab).delete().eq('id', id);
    load(tab);
  }

  async function saveCostRates() {
    setRateSaving(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      // Upsert a new labour_rate row per formulation with today's effective_date
      const rows = Object.entries(labourRates)
        .filter(([, rate]) => !isNaN(rate) && rate >= 0)
        .map(([formulation_id, rate]) => ({
          formulation_id,
          rate_per_tonne_usd: rate,
          effective_date: today,
        }));
      if (rows.length > 0) {
        await supabase.from('labour_rates').upsert(rows, { onConflict: 'formulation_id,effective_date' });
      }
      const pct = Number(overheadPctInput);
      if (!isNaN(pct)) {
        await supabase.from('cost_settings').upsert(
          { key: 'overhead_rate_percent', value: pct, description: 'Overhead cost as % of raw material cost' },
          { onConflict: 'key' }
        );
      }
      setRateSavedAt(Date.now());
    } catch (e: any) {
      alert('Failed to save rates: ' + e.message);
    } finally {
      setRateSaving(false);
    }
  }

  async function saveProfile() {
    if (!user) return;
    setSaving(true);
    await supabase.from('profiles').update(profileForm).eq('id', user.id);
    setSaving(false);
  }

  const f = (v: string) => v.toLowerCase().includes(search.toLowerCase());

  const filteredBranches = branches.filter(b => f(b.name) || f(b.code));
  const filteredWarehouses = warehouses.filter(w => f(w.name) || f(w.code));
  const filteredMachines = machines.filter(m => f(m.name) || f(m.code));
  const filteredSuppliers = suppliers.filter(s => f(s.name) || f(s.code));

  function set(key: string, value: any) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  const modalTitle = modal ? `${modal.type === 'add' ? 'Add' : 'Edit'} ${tab.slice(0, -1).replace(/^./, c => c.toUpperCase())}` : '';

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setSearch(''); }}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {tab !== 'profile' && tab !== 'cost_rates' && (
        <div className="flex items-center justify-between">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className={`${inputCls} pl-9 w-72`} />
          </div>
          <button onClick={openAdd} className={`${btnPrimary} flex items-center gap-2`}><Plus className="w-4 h-4" />Add {tab.slice(0, -1)}</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {tab === 'branches' && (
          <table className="w-full">
            <thead className="bg-slate-50"><tr><th className={thCls}>Code</th><th className={thCls}>Name</th><th className={thCls}>Contact Person</th><th className={thCls}>Phone</th><th className={thCls}>Active</th><th className={thCls}>Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBranches.map(b => (
                <tr key={b.id} className="hover:bg-slate-50"><td className={tdCls}><span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">{b.code}</span></td><td className={`${tdCls} font-medium`}>{b.name}</td><td className={tdCls}>{b.contact_person}</td><td className={tdCls}>{b.phone}</td><td className={tdCls}><ActiveDot active={b.is_active} /></td>
                  <td className={tdCls}><div className="flex gap-1"><button onClick={() => openEdit(b)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-teal-600"><Edit2 className="w-4 h-4" /></button><button onClick={() => handleDelete(b.id)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button></div></td></tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'warehouses' && (
          <table className="w-full">
            <thead className="bg-slate-50"><tr><th className={thCls}>MES Code</th><th className={thCls}>Sage Warehouse</th><th className={thCls}>Name</th><th className={thCls}>Type</th><th className={thCls}>Branch</th><th className={thCls}>Active</th><th className={thCls}>Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {filteredWarehouses.map(w => (
                <tr key={w.id} className="hover:bg-slate-50"><td className={tdCls}><span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">{w.code}</span></td><td className={tdCls}>{w.sage_warehouse_code ? <span className="font-mono text-xs text-teal-700">{w.sage_warehouse_code} ({w.sage_warehouse_id || '-'})</span> : <span className="text-xs text-amber-700">Not configured</span>}</td><td className={`${tdCls} font-medium`}>{w.name}</td><td className={tdCls}><StatusBadge status={w.type} /></td><td className={tdCls}>{w.branches?.name || '-'}</td><td className={tdCls}><ActiveDot active={w.is_active} /></td>
                  <td className={tdCls}><div className="flex gap-1"><button onClick={() => openEdit(w)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-teal-600"><Edit2 className="w-4 h-4" /></button><button onClick={() => handleDelete(w.id)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button></div></td></tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'machines' && (
          <table className="w-full">
            <thead className="bg-slate-50"><tr><th className={thCls}>Code</th><th className={thCls}>Name</th><th className={thCls}>Type</th><th className={thCls}>Capacity/hr</th><th className={thCls}>Status</th><th className={thCls}>Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {filteredMachines.map(m => (
                <tr key={m.id} className="hover:bg-slate-50"><td className={tdCls}><span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">{m.code}</span></td><td className={`${tdCls} font-medium`}>{m.name}</td><td className={tdCls}>{m.type}</td><td className={tdCls}>{m.capacity_per_hour} {m.capacity_unit}</td><td className={tdCls}><StatusBadge status={m.status} /></td>
                  <td className={tdCls}><div className="flex gap-1"><button onClick={() => openEdit(m)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-teal-600"><Edit2 className="w-4 h-4" /></button><button onClick={() => handleDelete(m.id)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button></div></td></tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'suppliers' && (
          <table className="w-full">
            <thead className="bg-slate-50"><tr><th className={thCls}>MES Code</th><th className={thCls}>Sage Code</th><th className={thCls}>Name</th><th className={thCls}>Contact</th><th className={thCls}>Email</th><th className={thCls}>Phone</th><th className={thCls}>Active</th><th className={thCls}>Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSuppliers.map(s => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className={tdCls}><span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">{s.code}</span></td>
                  <td className={tdCls}>{s.sage_code ? <span className="font-mono text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded border border-teal-200">{s.sage_code}</span> : <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">Missing</span>}</td>
                  <td className={`${tdCls} font-medium`}>{s.name}</td><td className={tdCls}>{s.contact_person}</td><td className={tdCls}>{s.email}</td><td className={tdCls}>{s.phone}</td><td className={tdCls}><ActiveDot active={s.is_active} /></td>
                  <td className={tdCls}><div className="flex gap-1"><button onClick={() => openEdit(s)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-teal-600"><Edit2 className="w-4 h-4" /></button><button onClick={() => handleDelete(s.id)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'cost_rates' && (
          <div className="p-6 space-y-6">
            <div>
              <h3 className="text-base font-semibold text-slate-800 mb-1">Overhead Rate</h3>
              <p className="text-xs text-slate-500 mb-3">Overhead cost is auto-calculated as this percentage of each production order's raw material cost.</p>
              <div className="flex items-center gap-3 max-w-sm">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={overheadPctInput}
                  onChange={e => setOverheadPctInput(e.target.value)}
                  className={inputCls}
                />
                <span className="text-sm font-medium text-slate-600">% of RM cost</span>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-6">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-semibold text-slate-800">Labour Rate per Formulation</h3>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input value={rateSearch} onChange={e => setRateSearch(e.target.value)} placeholder="Search code or name..." className={`${inputCls} pl-8 w-64 !py-1.5 text-xs`} />
                </div>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Per-tonne rate used to auto-calculate labour cost: <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">labour_cost = (actual_qty / 1000) × rate</code>. Saving adds a new effective-dated row per formulation.
                {usdZigRate !== null && (
                  <span className="ml-2 text-slate-600">ZIG equivalent shown using latest FX rate <strong>1 USD = {usdZigRate.toFixed(2)} ZiG</strong> from RM Cost Register.</span>
                )}
              </p>
              <div className="border border-slate-200 rounded-lg overflow-hidden max-h-[480px] overflow-y-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className={thCls}>Sage Code</th>
                      <th className={thCls}>Formulation</th>
                      <th className={thCls}>Category</th>
                      <th className={thCls}>Rate (USD/tonne)</th>
                      <th className={thCls}>Equivalent (ZiG/tonne)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {formulations.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">No active formulations found.</td></tr>
                    ) : formulations
                      .filter(f => !rateSearch || (f.sage_code || '').toLowerCase().includes(rateSearch.toLowerCase()) || f.name.toLowerCase().includes(rateSearch.toLowerCase()))
                      .map(fm => (
                        <tr key={fm.id}>
                          <td className={tdCls}><span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">{fm.sage_code || '—'}</span></td>
                          <td className={`${tdCls} font-medium`}>{fm.name}</td>
                          <td className={tdCls}><span className="text-xs text-slate-500">{fm.category || '—'}</span></td>
                          <td className={tdCls}>
                            <div className="flex items-center gap-2 max-w-[180px]">
                              <span className="text-slate-500 text-sm">$</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={labourRates[fm.id] ?? ''}
                                placeholder="5.00"
                                onChange={e => setLabourRates(prev => ({ ...prev, [fm.id]: Number(e.target.value) }))}
                                className={inputCls}
                              />
                              <span className="text-xs text-slate-500">/t</span>
                            </div>
                          </td>
                          <td className={tdCls}>
                            {usdZigRate !== null && labourRates[fm.id] != null && !isNaN(labourRates[fm.id]) ? (
                              <span className="text-sm text-slate-600">ZiG {(labourRates[fm.id] * usdZigRate).toFixed(2)}/t</span>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button onClick={saveCostRates} disabled={rateSaving} className={btnPrimary}>
                {rateSaving ? 'Saving...' : 'Save Cost Rates'}
              </button>
              {rateSavedAt && Date.now() - rateSavedAt < 3000 && (
                <span className="text-sm text-emerald-600 font-medium">✓ Saved</span>
              )}
            </div>
          </div>
        )}

        {tab === 'profile' && authProfile && (
          <div className="p-6 max-w-lg space-y-4">
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label><input value={profileForm.full_name} onChange={e => setProfileForm(p => ({ ...p, full_name: e.target.value }))} className={inputCls} /></div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Email</label><input value={authProfile.email} readOnly className={`${inputCls} bg-slate-50 text-slate-500 cursor-not-allowed`} /></div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Phone</label><input value={profileForm.phone} onChange={e => setProfileForm(p => ({ ...p, phone: e.target.value }))} className={inputCls} /></div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Role</label><input value={authProfile.role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} readOnly className={`${inputCls} bg-slate-50 text-slate-500 cursor-not-allowed`} /></div>
            <button onClick={saveProfile} disabled={saving} className={btnPrimary}>{saving ? 'Saving...' : 'Save Changes'}</button>
          </div>
        )}
      </div>

      <Modal open={!!modal && modal.tab === 'branches'} onClose={() => setModal(null)} title={modalTitle}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Name</label><input value={form.name || ''} onChange={e => set('name', e.target.value)} className={inputCls} /></div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Code</label><input value={form.code || ''} onChange={e => set('code', e.target.value)} className={inputCls} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Sage Branch Account</label><input value={form.sage_code || ''} onChange={e => set('sage_code', e.target.value.toUpperCase())} className={inputCls} /></div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Sage Warehouse Code</label><input value={form.sage_warehouse_code || ''} onChange={e => set('sage_warehouse_code', e.target.value.toUpperCase())} className={inputCls} /></div>
          </div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Sage Warehouse ID</label><input type="number" min="1" value={form.sage_warehouse_id || ''} onChange={e => set('sage_warehouse_id', e.target.value ? Number(e.target.value) : null)} className={inputCls} /></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Address</label><input value={form.address || ''} onChange={e => set('address', e.target.value)} className={inputCls} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Contact Person</label><input value={form.contact_person || ''} onChange={e => set('contact_person', e.target.value)} className={inputCls} /></div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Phone</label><input value={form.phone || ''} onChange={e => set('phone', e.target.value)} className={inputCls} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active ?? true} onChange={e => set('is_active', e.target.checked)} className="rounded border-slate-300 text-teal-600 focus:ring-teal-500" />Active</label>
          <div className="flex justify-end gap-3 pt-2"><button onClick={() => setModal(null)} className={btnSecondary}>Cancel</button><button onClick={handleSave} disabled={saving} className={btnPrimary}>{saving ? 'Saving...' : 'Save'}</button></div>
        </div>
      </Modal>

      <Modal open={!!modal && modal.tab === 'warehouses'} onClose={() => setModal(null)} title={modalTitle}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Name</label><input value={form.name || ''} onChange={e => set('name', e.target.value)} className={inputCls} /></div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Code</label><input value={form.code || ''} onChange={e => set('code', e.target.value)} className={inputCls} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Type</label><select value={form.type || 'raw_material'} onChange={e => set('type', e.target.value)} className={inputCls}><option value="raw_material">Raw Material</option><option value="finished_goods">Finished Goods</option></select></div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Branch</label><select value={form.branch_id || ''} onChange={e => set('branch_id', e.target.value || null)} className={inputCls}><option value="">Select branch</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Sage Warehouse Code</label><input value={form.sage_warehouse_code || ''} onChange={e => set('sage_warehouse_code', e.target.value.toUpperCase())} className={inputCls} placeholder="e.g. GLE" /></div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Sage Warehouse ID</label><input type="number" min="1" value={form.sage_warehouse_id || ''} onChange={e => set('sage_warehouse_id', e.target.value ? Number(e.target.value) : null)} className={inputCls} placeholder="e.g. 36" /></div>
          </div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Location</label><input value={form.location || ''} onChange={e => set('location', e.target.value)} className={inputCls} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active ?? true} onChange={e => set('is_active', e.target.checked)} className="rounded border-slate-300 text-teal-600 focus:ring-teal-500" />Active</label>
          <div className="flex justify-end gap-3 pt-2"><button onClick={() => setModal(null)} className={btnSecondary}>Cancel</button><button onClick={handleSave} disabled={saving} className={btnPrimary}>{saving ? 'Saving...' : 'Save'}</button></div>
        </div>
      </Modal>

      <Modal open={!!modal && modal.tab === 'machines'} onClose={() => setModal(null)} title={modalTitle}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Name</label><input value={form.name || ''} onChange={e => set('name', e.target.value)} className={inputCls} /></div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Code</label><input value={form.code || ''} onChange={e => set('code', e.target.value)} className={inputCls} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Type</label><input value={form.type || ''} onChange={e => set('type', e.target.value)} className={inputCls} /></div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Status</label><select value={form.status || 'operational'} onChange={e => set('status', e.target.value)} className={inputCls}><option value="operational">Operational</option><option value="maintenance">Maintenance</option><option value="breakdown">Breakdown</option><option value="decommissioned">Decommissioned</option></select></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Capacity/hr</label><input type="number" value={form.capacity_per_hour ?? 0} onChange={e => set('capacity_per_hour', Number(e.target.value))} className={inputCls} /></div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Capacity Unit</label><input value={form.capacity_unit || ''} onChange={e => set('capacity_unit', e.target.value)} className={inputCls} /></div>
          </div>
          <div className="flex justify-end gap-3 pt-2"><button onClick={() => setModal(null)} className={btnSecondary}>Cancel</button><button onClick={handleSave} disabled={saving} className={btnPrimary}>{saving ? 'Saving...' : 'Save'}</button></div>
        </div>
      </Modal>

      <Modal open={!!modal && modal.tab === 'suppliers'} onClose={() => setModal(null)} title={modalTitle} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Name</label><input value={form.name || ''} onChange={e => set('name', e.target.value)} className={inputCls} /></div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">MES Code</label><input value={form.code || ''} onChange={e => set('code', e.target.value)} className={inputCls} /></div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Sage Code <span className="text-xs font-normal text-slate-500">(required for Sage sync)</span></label>
            <input value={form.sage_code || ''} onChange={e => set('sage_code', e.target.value)} placeholder="e.g. SUP001" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Contact Person</label><input value={form.contact_person || ''} onChange={e => set('contact_person', e.target.value)} className={inputCls} /></div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Email</label><input type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} className={inputCls} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Phone</label><input value={form.phone || ''} onChange={e => set('phone', e.target.value)} className={inputCls} /></div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Payment Terms</label><input value={form.payment_terms || ''} onChange={e => set('payment_terms', e.target.value)} className={inputCls} /></div>
          </div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Address</label><input value={form.address || ''} onChange={e => set('address', e.target.value)} className={inputCls} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active ?? true} onChange={e => set('is_active', e.target.checked)} className="rounded border-slate-300 text-teal-600 focus:ring-teal-500" />Active</label>
          <div className="flex justify-end gap-3 pt-2"><button onClick={() => setModal(null)} className={btnSecondary}>Cancel</button><button onClick={handleSave} disabled={saving} className={btnPrimary}>{saving ? 'Saving...' : 'Save'}</button></div>
        </div>
      </Modal>
    </div>
  );
}
