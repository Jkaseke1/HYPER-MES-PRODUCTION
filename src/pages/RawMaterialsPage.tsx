import { useState, useEffect, useMemo } from 'react';
import { Plus, Search, CreditCard as Edit2, Trash2, Package, AlertTriangle, DollarSign, Layers, GitBranch, RefreshCw, BellRing, ClipboardList } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { RawMaterial } from '../types/database';
import Modal from '../components/ui/Modal';
import StatCard from '../components/ui/StatCard';
import StockTakeFrozenBanner from '../components/stock/StockTakeFrozenBanner';

const CATEGORIES = ['grain', 'protein', 'mineral', 'vitamin', 'additive', 'other'] as const;
const UNITS = ['kg', 'ton', 'litre', 'bag'] as const;
const TABS = ['All', ...CATEGORIES] as const;

const emptyForm = { name: '', code: '', category: 'grain', unit: 'ton', cost_per_unit: 0, reorder_level: 0, description: '', currency_code: 'USD', warehouse_id: '' };

const stockStyles: Record<string, string> = {
  in_stock: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  low_stock: 'bg-amber-50 text-amber-700 border-amber-200',
  critical: 'bg-orange-50 text-orange-700 border-orange-200',
  out_of_stock: 'bg-red-50 text-red-700 border-red-200',
  reorder_not_set: 'bg-slate-100 text-slate-600 border-slate-200',
};

const stockLabels: Record<string, string> = {
  in_stock: 'In Stock',
  low_stock: 'Watch List',
  critical: 'Reorder Now',
  out_of_stock: 'Out Of Stock',
  reorder_not_set: 'Reorder Not Set',
};

function getAlertBand(material: RawMaterial): string {
  const current = Number(material.current_stock || 0);
  const reorder = Number(material.reorder_level || 0);
  const thresholdPct = Number(material.alert_threshold_pct ?? 0.1);
  const watchLimit = reorder > 0 ? reorder * (1 + thresholdPct) : 0;

  if (current <= 0) return 'out_of_stock';
  if (reorder <= 0) return 'reorder_not_set';
  if (current <= reorder) return 'critical';
  if (current <= watchLimit) return 'low_stock';
  return 'in_stock';
}

function getReorderQty(material: RawMaterial): number {
  const current = Number(material.current_stock || 0);
  const reorder = Number(material.reorder_level || 0);
  return Math.max(0, reorder - current);
}

export default function RawMaterialsPage() {
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const [stockFilter, setStockFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [editing, setEditing] = useState<RawMaterial | null>(null);
  const [deleting, setDeleting] = useState<RawMaterial | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [refreshingStock, setRefreshingStock] = useState(false);
  const [lastDbCheck, setLastDbCheck] = useState<Date | null>(null);
  
  // Inline reorder level editing state
  const [editingReorder, setEditingReorder] = useState<string | null>(null);
  const [reorderValue, setReorderValue] = useState<string>('');

  // Stock-by-batch drawer state
  const [lotModalOpen, setLotModalOpen] = useState(false);
  const [lotMaterial, setLotMaterial] = useState<RawMaterial | null>(null);
  const [lots, setLots] = useState<any[]>([]);
  const [lotsLoading, setLotsLoading] = useState(false);

  // Where Used state
  const [whereUsedOpen, setWhereUsedOpen] = useState(false);
  const [whereUsedMaterial, setWhereUsedMaterial] = useState<RawMaterial | null>(null);
  const [whereUsedData, setWhereUsedData] = useState<any[]>([]);
  const [whereUsedLoading, setWhereUsedLoading] = useState(false);

  async function openWhereUsed(m: RawMaterial) {
    setWhereUsedMaterial(m);
    setWhereUsedOpen(true);
    setWhereUsedLoading(true);
    const { data, error } = await supabase
      .from('formulation_ingredients')
      .select('formulation_id, quantity, unit, percentage, formulations(id, name, code, status, batch_size, batch_unit)')
      .eq('raw_material_id', m.id);
    if (error) console.error('Failed to load where used:', error);
    setWhereUsedData(data || []);
    setWhereUsedLoading(false);
  }

  async function openLots(m: RawMaterial) {
    setLotMaterial(m);
    setLotModalOpen(true);
    setLotsLoading(true);
    const { data, error } = await supabase
      .from('v_rm_available_lots')
      .select('lot_id, batch_number, qty_remaining, unit, unit_cost, received_date, expiry_date, source, grn_number')
      .eq('raw_material_id', m.id);
    if (error) console.error('Failed to load lots:', error);
    setLots(data || []);
    setLotsLoading(false);
  }

  async function fetchMaterials(options: { silent?: boolean } = {}) {
    if (!options.silent) setLoading(true);
    const { data } = await supabase
      .from('raw_materials')
      .select('*')
      .eq('is_active', true)
      .order('name');
    setMaterials(data || []);
    setLastDbCheck(new Date());
    if (!options.silent) setLoading(false);
  }

  async function refreshStockFromDb() {
    setRefreshingStock(true);
    await fetchMaterials({ silent: true });
    setRefreshingStock(false);
  }

  async function checkCriticalAlerts() {
    setStockFilter('critical_alerts');
    setRefreshingStock(true);
    await fetchMaterials({ silent: true });
    setRefreshingStock(false);
  }

  async function fetchCurrencies() {
    const { data } = await supabase.from('currencies').select('*').eq('is_active', true).order('code');
    setCurrencies(data || []);
  }

  async function fetchWarehouses() {
    const { data } = await supabase.from('warehouses').select('*').eq('is_active', true).order('name');
    setWarehouses(data || []);
  }

  useEffect(() => { 
    fetchMaterials(); 
    fetchCurrencies();
    fetchWarehouses();
  }, []);

  const filtered = useMemo(() => {
    let list = materials;
    if (activeTab !== 'All') list = list.filter((m) => m.category === activeTab);
    if (stockFilter === 'critical_alerts') list = list.filter((m) => ['out_of_stock', 'critical'].includes(getAlertBand(m)));
    if (stockFilter === 'watch_list') list = list.filter((m) => ['out_of_stock', 'critical', 'low_stock'].includes(getAlertBand(m)));
    if (stockFilter === 'out_of_stock') list = list.filter((m) => getAlertBand(m) === 'out_of_stock');
    if (stockFilter === 'reorder_not_set') list = list.filter((m) => getAlertBand(m) === 'reorder_not_set');
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((m) => m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q));
    }
    return list;
  }, [materials, activeTab, stockFilter, search]);

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEdit(m: RawMaterial) {
    setEditing(m);
    setForm({ name: m.name, code: m.code, category: m.category, unit: m.unit, cost_per_unit: m.cost_per_unit, reorder_level: m.reorder_level, description: m.description || '', currency_code: m.currency_code || 'USD', warehouse_id: m.warehouse_id || '' });
    setModalOpen(true);
  }

  function openDelete(m: RawMaterial) {
    setDeleting(m);
    setDeleteModalOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      let result;
      if (editing) {
        result = await supabase.from('raw_materials').update(form).eq('id', editing.id);
      } else {
        result = await supabase.from('raw_materials').insert(form);
      }
      
      if (result.error) {
        console.error('Error saving material:', result.error);
        alert(`Error: ${result.error.message}`);
        setSaving(false);
        return;
      }
      
      setSaving(false);
      setModalOpen(false);
      fetchMaterials();
    } catch (error) {
      console.error('Unexpected error:', error);
      alert('An unexpected error occurred. Please try again.');
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setSaving(true);
    await supabase.from('raw_materials').delete().eq('id', deleting.id);
    setSaving(false);
    setDeleteModalOpen(false);
    setDeleting(null);
    fetchMaterials();
  }

  // Inline reorder level editing functions
  function startEditingReorder(materialId: string, currentValue: number) {
    setEditingReorder(materialId);
    setReorderValue(currentValue.toString());
  }

  async function saveReorderLevel(materialId: string) {
    const newValue = parseFloat(reorderValue) || 0;
    
    try {
      const { error } = await supabase
        .from('raw_materials')
        .update({ reorder_level: newValue })
        .eq('id', materialId);

      if (error) throw error;

      // Update local state
      setMaterials(prev => prev.map(m => 
        m.id === materialId ? { ...m, reorder_level: newValue } : m
      ));
    } catch (error: any) {
      console.error('Error saving reorder level:', error);
      alert('Failed to save reorder level: ' + error.message);
    }
    
    setEditingReorder(null);
    setReorderValue('');
  }

  function cancelEditingReorder() {
    setEditingReorder(null);
    setReorderValue('');
  }

  const inputClass = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors';

  const totalMaterials = materials.length;
  const outOfStockCount = materials.filter(m => getAlertBand(m) === 'out_of_stock').length;
  const criticalCount = materials.filter(m => getAlertBand(m) === 'critical').length;
  const watchListCount = materials.filter(m => ['out_of_stock', 'critical', 'low_stock'].includes(getAlertBand(m))).length;
  const reorderNotSetCount = materials.filter(m => getAlertBand(m) === 'reorder_not_set').length;
  const totalValue = materials.reduce((sum, m) => sum + (m.current_stock * m.cost_per_unit), 0);
  const criticalPreview = materials
    .filter((m) => ['out_of_stock', 'critical'].includes(getAlertBand(m)))
    .slice()
    .sort((a, b) => getReorderQty(b) - getReorderQty(a))
    .slice(0, 6);

  return (
    <div className="p-6 space-y-6">
      <StockTakeFrozenBanner />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Raw Materials</h1>
          <p className="text-sm text-slate-500 mt-1">Manage inventory, reorder points and critical material alerts</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refreshStockFromDb} disabled={refreshingStock} className="inline-flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-sm font-semibold transition-colors shadow-sm disabled:opacity-60">
            <RefreshCw className={`w-4 h-4 ${refreshingStock ? 'animate-spin' : ''}`} /> Refresh DB Stock
          </button>
          <button onClick={checkCriticalAlerts} disabled={refreshingStock} className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm disabled:opacity-60">
            <BellRing className="w-4 h-4" /> Check Critical Alerts
          </button>
          <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm">
            <Plus className="w-4 h-4" /> Add Material
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard title="Total Materials" value={totalMaterials} icon={Package} color="teal" />
        <StatCard title="Critical Reorder" value={criticalCount} icon={BellRing} color="amber" />
        <StatCard title="Watch List" value={watchListCount} icon={AlertTriangle} color="amber" />
        <StatCard title="Out of Stock" value={outOfStockCount} icon={Layers} color="red" />
        <StatCard title="Total Value" value={`$${totalValue.toLocaleString(undefined, {maximumFractionDigits: 0})}`} icon={DollarSign} color="emerald" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4 p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center border border-red-100">
              <ClipboardList className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900">Reorder control board</h2>
              <p className="text-sm text-slate-500">
                {outOfStockCount} out of stock, {criticalCount} at/below reorder level, {reorderNotSetCount} missing reorder levels.
                {lastDbCheck && <span className="ml-1">Last database check: {lastDbCheck.toLocaleTimeString()}.</span>}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              ['all', 'All Materials'],
              ['critical_alerts', 'Critical Alerts'],
              ['watch_list', 'Watch List'],
              ['out_of_stock', 'Out of Stock'],
              ['reorder_not_set', 'Reorder Not Set'],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setStockFilter(value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${stockFilter === value ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {criticalPreview.length > 0 && (
          <div className="border-t border-slate-100 px-4 py-3 bg-red-50/60">
            <p className="text-xs font-bold uppercase tracking-wide text-red-700 mb-2">Top materials needing attention</p>
            <div className="flex flex-wrap gap-2">
              {criticalPreview.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setStockFilter('all');
                    setSearch(m.code);
                  }}
                  className="px-3 py-1.5 rounded-full bg-white border border-red-100 text-xs text-red-700 hover:border-red-300"
                >
                  {m.code} · {stockLabels[getAlertBand(m)]} · {m.current_stock.toLocaleString()} {m.unit}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="p-4 border-b border-slate-200 space-y-4">
          <div className="flex items-center gap-2 overflow-x-auto">
            {TABS.map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`px-3.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${activeTab === tab ? 'bg-teal-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
                {tab}
              </button>
            ))}
          </div>
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" placeholder="Search by name or code..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors" />
            </div>
            {stockFilter !== 'all' && (
              <button onClick={() => setStockFilter('all')} className="text-xs font-semibold text-slate-500 hover:text-slate-800">
                Clear alert filter
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Package className="w-12 h-12 mb-3" />
            <p className="text-sm font-medium">No materials found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  {['Code', 'Name', 'Category', 'Unit', 'Cost/Unit', 'Current Stock', 'Valuation', 'Reorder Level', 'Reorder Advice', 'Status', ''].map((h) => (
                    <th key={h} className="text-left px-4 py-3 font-semibold text-slate-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((m) => {
                  const status = getAlertBand(m);
                  const reorderQty = getReorderQty(m);
                  return (
                    <tr key={m.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{m.code}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{m.name}</td>
                      <td className="px-4 py-3 text-slate-600">{m.category.charAt(0).toUpperCase() + m.category.slice(1)}</td>
                      <td className="px-4 py-3 text-slate-600">{m.unit}</td>
                      <td className="px-4 py-3 text-slate-700 font-medium">{m.cost_per_unit.toLocaleString('en-US', { style: 'currency', currency: m.currency_code || 'USD' })}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openLots(m)}
                          className="flex items-center gap-1.5 hover:underline hover:text-teal-700 cursor-pointer"
                          title="Click to see stock by batch / GRN lot"
                        >
                          {['critical', 'low_stock'].includes(status) && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
                          <span className={status === 'out_of_stock' ? 'text-red-600 font-medium' : 'text-slate-700'}>{m.current_stock.toLocaleString()}</span>
                          <Layers className="w-3 h-3 text-slate-400" />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-slate-700 font-medium">
                        {(m.current_stock * m.cost_per_unit).toLocaleString('en-US', { style: 'currency', currency: m.currency_code || 'USD' })}
                      </td>
                      <td className="px-4 py-3">
                        {editingReorder === m.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={reorderValue}
                              onChange={(e) => setReorderValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  saveReorderLevel(m.id);
                                } else if (e.key === 'Escape') {
                                  cancelEditingReorder();
                                }
                              }}
                              onBlur={() => saveReorderLevel(m.id)}
                              className="w-20 px-2 py-1 border border-teal-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                              autoFocus
                            />
                            <button
                              onClick={() => saveReorderLevel(m.id)}
                              className="p-1 rounded text-teal-600 hover:bg-teal-50"
                              title="Save"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={cancelEditingReorder}
                              className="p-1 rounded text-slate-400 hover:bg-slate-50"
                              title="Cancel"
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEditingReorder(m.id, m.reorder_level)}
                            className="text-slate-600 hover:text-teal-600 hover:bg-teal-50 px-2 py-1 rounded text-sm transition-colors"
                            title="Click to edit reorder level"
                          >
                            {m.reorder_level.toLocaleString()}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {status === 'reorder_not_set' ? (
                          <span className="text-slate-500">Set reorder level</span>
                        ) : reorderQty > 0 ? (
                          <span className="font-bold text-red-700">Order {reorderQty.toLocaleString()} {m.unit}</span>
                        ) : status === 'low_stock' ? (
                          <span className="font-semibold text-amber-700">Monitor closely</span>
                        ) : (
                          <span className="text-emerald-700">Above reorder</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full border ${stockStyles[status]}`}>
                          {stockLabels[status]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openWhereUsed(m)} className="p-1.5 rounded-lg text-slate-400 hover:text-purple-600 hover:bg-purple-50 transition-colors" title="Where Used">
                            <GitBranch className="w-4 h-4" />
                          </button>
                          <button onClick={() => openEdit(m)} className="p-1.5 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => openDelete(m)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/50">
          <p className="text-xs text-slate-500">{filtered.length} material{filtered.length !== 1 ? 's' : ''} shown · Stock shown is the latest value loaded from MES database.</p>
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Material' : 'Add Material'} size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Name</label>
              <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} placeholder="e.g. Yellow Maize" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Code</label>
              <input type="text" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={inputClass} placeholder="e.g. RM-001" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Category</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputClass}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Unit</label>
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={inputClass}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Cost per Unit</label>
              <input type="number" required min="0" step="0.01" value={form.cost_per_unit || ''} onChange={(e) => setForm({ ...form, cost_per_unit: e.target.value === '' ? 0 : parseFloat(e.target.value) })} className={inputClass} placeholder="0.00" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Currency</label>
              <select value={form.currency_code} onChange={(e) => setForm({ ...form, currency_code: e.target.value })} className={inputClass}>
                {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} - {c.name} ({c.symbol})</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Reorder Level</label>
              <input type="number" required min="0" step="0.01" value={form.reorder_level || ''} onChange={(e) => setForm({ ...form, reorder_level: e.target.value === '' ? 0 : parseFloat(e.target.value) })} className={inputClass} placeholder="0.00" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Warehouse</label>
              <select value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })} className={inputClass}>
                <option value="">Select Warehouse (Optional)</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
            <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} placeholder="Optional description..." />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50">{saving ? 'Saving...' : editing ? 'Update Material' : 'Add Material'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={lotModalOpen} onClose={() => setLotModalOpen(false)} title={`Stock by Batch — ${lotMaterial?.name || ''}`} size="xl">
        <div className="space-y-3">
          {lotMaterial && (
            <div className="flex items-center justify-between text-sm p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div>
                <div className="text-slate-500 text-xs">Current Stock</div>
                <div className="font-semibold text-slate-800">{lotMaterial.current_stock.toLocaleString()} {lotMaterial.unit}</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs">Active Lots</div>
                <div className="font-semibold text-slate-800">{lots.length}</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs">Sum of Lot Balances</div>
                <div className="font-semibold text-slate-800">{lots.reduce((s, l) => s + Number(l.qty_remaining || 0), 0).toLocaleString()} {lotMaterial.unit}</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs">Total Value</div>
                <div className="font-semibold text-slate-800">${lots.reduce((s, l) => s + Number(l.qty_remaining || 0) * Number(l.unit_cost || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
              </div>
            </div>
          )}

          {lotsLoading ? (
            <div className="py-8 text-center text-slate-400 text-sm">Loading lots...</div>
          ) : lots.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">No active lots for this material. Stock may be zero or pre-dates lot tracking.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50 text-xs">
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Batch / Lot</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Source</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">GRN</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">Qty Remaining</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">Unit Cost</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Received</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Expiry</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lots.map((l) => (
                    <tr key={l.lot_id} className="hover:bg-slate-50/50">
                      <td className="px-3 py-2 font-mono text-xs text-slate-700">{l.batch_number}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs ${l.source === 'grn' ? 'bg-teal-50 text-teal-700' : l.source === 'opening_balance' ? 'bg-slate-100 text-slate-600' : 'bg-blue-50 text-blue-700'}`}>
                          {l.source === 'opening_balance' ? 'Opening' : l.source}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600 font-mono text-xs">{l.grn_number || '-'}</td>
                      <td className="px-3 py-2 text-right font-medium text-slate-800">{Number(l.qty_remaining).toLocaleString()} {l.unit}</td>
                      <td className="px-3 py-2 text-right text-slate-600">${Number(l.unit_cost || 0).toFixed(4)}</td>
                      <td className="px-3 py-2 text-slate-600 text-xs">{l.received_date ? new Date(l.received_date).toLocaleDateString() : '-'}</td>
                      <td className="px-3 py-2 text-slate-600 text-xs">{l.expiry_date ? new Date(l.expiry_date).toLocaleDateString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-[11px] text-slate-400">Sorted FIFO (oldest received first). Issued/transferred quantities are depleted from the top.</p>
        </div>
      </Modal>

      <Modal open={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} title="Delete Material" size="sm">
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
            <p className="text-sm text-red-700">Are you sure you want to delete <span className="font-semibold">{deleting?.name}</span>? This action cannot be undone.</p>
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setDeleteModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">Cancel</button>
            <button onClick={handleDelete} disabled={saving} className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50">{saving ? 'Deleting...' : 'Delete'}</button>
          </div>
        </div>
      </Modal>

      <Modal open={whereUsedOpen} onClose={() => setWhereUsedOpen(false)} title={`Where Used — ${whereUsedMaterial?.name || ''}`} size="xl">
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-3 bg-purple-50 border border-purple-200 rounded-lg">
            <GitBranch className="w-4 h-4 text-purple-600 shrink-0" />
            <p className="text-sm text-purple-800">Formulations that contain <span className="font-semibold">{whereUsedMaterial?.name}</span> as an ingredient.</p>
          </div>
          {whereUsedLoading ? (
            <div className="py-8 text-center text-slate-400 text-sm">Searching formulations...</div>
          ) : whereUsedData.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">This material is not used in any active formulation.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50 text-xs">
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Formulation</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Code</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">Qty / Batch</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">% of BOM</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Batch Size</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {whereUsedData.map((row: any, idx) => {
                    const f = row.formulations;
                    if (!f) return null;
                    return (
                      <tr key={idx} className="hover:bg-purple-50/40">
                        <td className="px-3 py-2 font-medium text-slate-800">{f.name}</td>
                        <td className="px-3 py-2"><code className="text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-700">{f.code}</code></td>
                        <td className="px-3 py-2 text-right font-medium text-slate-700">{Number(row.quantity).toLocaleString()} {row.unit}</td>
                        <td className="px-3 py-2 text-right"><span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs font-semibold">{Number(row.percentage).toFixed(1)}%</span></td>
                        <td className="px-3 py-2 text-slate-600">{f.batch_size?.toLocaleString()} {f.batch_unit}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${f.status === 'active' ? 'bg-emerald-50 text-emerald-700' : f.status === 'draft' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                            {f.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-slate-400">{whereUsedData.length} formulation{whereUsedData.length !== 1 ? 's' : ''} use this material. Click the <span className="font-semibold">GitBranch</span> icon on any material row to check.</p>
        </div>
      </Modal>
    </div>
  );
}
