import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Search, Package, AlertCircle, Trash2, CreditCard as Edit2, AlertTriangle, ShieldCheck } from 'lucide-react';
import type { SparePart } from '../types/maintenance';
import type { Warehouse, Supplier } from '../types/database';
import { SPARE_PART_CATEGORIES } from '../types/maintenance';
import Modal from '../components/ui/Modal';
import StatCard from '../components/ui/StatCard';

export default function SparePartsPage() {
  const [parts, setParts] = useState<SparePart[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');

  const [form, setForm] = useState<{
    code: string;
    name: string;
    description: string;
    category: 'mechanical' | 'electrical' | 'consumable' | 'lubricant' | 'safety' | 'other';
    unit: string;
    unit_cost: number;
    currency_code: string;
    reorder_level: number;
    current_stock: number;
    warehouse_id: string;
    supplier_id: string;
    lead_time_days: number;
    is_critical: boolean;
    is_active: boolean;
  }>({
    code: '',
    name: '',
    description: '',
    category: 'mechanical',
    unit: 'pcs',
    unit_cost: 0,
    currency_code: 'USD',
    reorder_level: 0,
    current_stock: 0,
    warehouse_id: '',
    supplier_id: '',
    lead_time_days: 7,
    is_critical: false,
    is_active: true
  });

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [partsRes, warehousesRes, suppliersRes] = await Promise.all([
        supabase.from('spare_parts').select('*').order('code'),
        supabase.from('warehouses').select('*').eq('is_active', true),
        supabase.from('suppliers').select('*').eq('is_active', true)
      ]);

      if (partsRes.data) setParts(partsRes.data);
      if (warehousesRes.data) setWarehouses(warehousesRes.data);
      if (suppliersRes.data) setSuppliers(suppliersRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setForm({
      code: '',
      name: '',
      description: '',
      category: 'mechanical',
      unit: 'pcs',
      unit_cost: 0,
      currency_code: 'USD',
      reorder_level: 0,
      current_stock: 0,
      warehouse_id: '',
      supplier_id: '',
      lead_time_days: 7,
      is_critical: false,
      is_active: true
    });
    setEditingId(null);
    setShowModal(true);
  }

  function openEdit(part: SparePart) {
    setForm({
      code: part.code,
      name: part.name,
      description: part.description || '',
      category: part.category,
      unit: part.unit,
      unit_cost: part.unit_cost,
      currency_code: part.currency_code,
      reorder_level: part.reorder_level,
      current_stock: part.current_stock,
      warehouse_id: part.warehouse_id || '',
      supplier_id: part.supplier_id || '',
      lead_time_days: part.lead_time_days,
      is_critical: part.is_critical,
      is_active: part.is_active
    });
    setEditingId(part.id);
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.code || !form.name) {
      alert('Please fill in all required fields');
      return;
    }

    try {
      if (editingId) {
        await supabase.from('spare_parts').update(form).eq('id', editingId);
      } else {
        await supabase.from('spare_parts').insert([form]);
      }
      setShowModal(false);
      fetchData();
    } catch (error) {
      console.error('Error saving spare part:', error);
      alert('Failed to save spare part');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this spare part?')) return;
    try {
      await supabase.from('spare_parts').delete().eq('id', id);
      fetchData();
    } catch (error) {
      console.error('Error deleting spare part:', error);
    }
  }

  const filteredParts = parts.filter(part => {
    const matchesSearch = part.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          part.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === 'all' || part.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const lowStockParts = parts.filter(p => p.current_stock <= p.reorder_level && p.is_active);

  const iCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500';
  const sCls = `${iCls} bg-white`;
  const totalValue = parts.reduce((s, p) => s + p.current_stock * p.unit_cost, 0);
  const criticalCount = parts.filter(p => p.is_critical).length;

  if (loading) return (
    <div className="flex items-center justify-center h-96">
      <div className="w-8 h-8 border-2 border-slate-200 border-t-teal-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Spare Parts Inventory</h1>
          <p className="text-sm text-slate-500 mt-1">Manage maintenance spare parts and consumables</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold transition-colors">
          <Plus className="w-4 h-4" /> Add Spare Part
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Parts" value={parts.length} icon={Package} color="teal" />
        <StatCard title="Low / Out of Stock" value={lowStockParts.length} icon={AlertTriangle} color="amber" />
        <StatCard title="Critical Parts" value={criticalCount} icon={ShieldCheck} color="red" />
        <StatCard title="Total Value" value={`$${totalValue.toLocaleString(undefined, {maximumFractionDigits: 0})}`} icon={AlertCircle} color="emerald" />
      </div>

      {lowStockParts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Low Stock Alert — {lowStockParts.length} part{lowStockParts.length > 1 ? 's' : ''} below reorder level</p>
            <p className="text-xs text-amber-700 mt-1">{lowStockParts.slice(0, 5).map(p => `${p.code} (${p.current_stock} ${p.unit})`).join(' · ')}{lowStockParts.length > 5 ? ` · +${lowStockParts.length - 5} more` : ''}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-xl">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search spare parts..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
          </div>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className={sCls}>
            <option value="all">All Categories</option>
            {SPARE_PART_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['Code', 'Name', 'Category', 'Stock', 'Reorder Level', 'Unit Cost', 'Critical', 'Actions'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredParts.map(part => {
                const isLow = part.current_stock <= part.reorder_level;
                return (
                  <tr key={part.id} className={`hover:bg-slate-50 transition-colors ${isLow ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-5 py-3 font-mono text-xs text-slate-600 font-medium">{part.code}</td>
                    <td className="px-5 py-3 text-slate-800 font-medium">{part.name}</td>
                    <td className="px-5 py-3"><span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs font-medium capitalize">{part.category}</span></td>
                    <td className="px-5 py-3">
                      <span className={`font-semibold text-sm ${isLow ? 'text-amber-700' : 'text-slate-800'}`}>{part.current_stock}</span>
                      <span className="text-slate-400 text-xs ml-1">{part.unit}</span>
                    </td>
                    <td className="px-5 py-3 text-slate-500 text-xs">{part.reorder_level} {part.unit}</td>
                    <td className="px-5 py-3 text-slate-700">{part.currency_code} {part.unit_cost.toFixed(2)}</td>
                    <td className="px-5 py-3">
                      {part.is_critical && <span className="px-2 py-0.5 bg-red-50 text-red-700 border border-red-200 rounded text-xs font-medium">Critical</span>}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(part)} className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"><Edit2 className="w-3 h-3" /> Edit</button>
                        <button onClick={() => handleDelete(part.id)} className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"><Trash2 className="w-3 h-3" /> Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredParts.length === 0 && (
            <div className="text-center py-16">
              <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No spare parts found</p>
            </div>
          )}
        </div>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editingId ? 'Edit Spare Part' : 'New Spare Part'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Code *</label><input type="text" value={form.code} onChange={(e) => setForm({...form, code: e.target.value})} className={iCls} /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Category *</label><select value={form.category} onChange={(e) => setForm({...form, category: e.target.value as any})} className={sCls}>{SPARE_PART_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
          </div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1">Name *</label><input type="text" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className={iCls} /></div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1">Description</label><textarea value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} rows={2} className={`${iCls} resize-none`}></textarea></div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Unit</label><input type="text" value={form.unit} onChange={(e) => setForm({...form, unit: e.target.value})} placeholder="pcs, kg" className={iCls} /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Current Stock</label><input type="number" value={form.current_stock} onChange={(e) => setForm({...form, current_stock: parseFloat(e.target.value) || 0})} className={iCls} /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Reorder Level</label><input type="number" value={form.reorder_level} onChange={(e) => setForm({...form, reorder_level: parseFloat(e.target.value) || 0})} className={iCls} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Unit Cost</label><input type="number" step="0.01" value={form.unit_cost} onChange={(e) => setForm({...form, unit_cost: parseFloat(e.target.value) || 0})} className={iCls} /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Currency</label><input type="text" value={form.currency_code} onChange={(e) => setForm({...form, currency_code: e.target.value})} className={iCls} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Warehouse</label><select value={form.warehouse_id} onChange={(e) => setForm({...form, warehouse_id: e.target.value})} className={sCls}><option value="">Select warehouse</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Supplier</label><select value={form.supplier_id} onChange={(e) => setForm({...form, supplier_id: e.target.value})} className={sCls}><option value="">Select supplier</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          </div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1">Lead Time (days)</label><input type="number" value={form.lead_time_days} onChange={(e) => setForm({...form, lead_time_days: parseInt(e.target.value) || 0})} className={iCls} /></div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_critical} onChange={(e) => setForm({...form, is_critical: e.target.checked})} className="rounded border-slate-300 text-teal-600 focus:ring-teal-500" /><span className="font-medium text-slate-700">Critical Part</span></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({...form, is_active: e.target.checked})} className="rounded border-slate-300 text-teal-600 focus:ring-teal-500" /><span className="font-medium text-slate-700">Active</span></label>
          </div>
          <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">Cancel</button>
            <button onClick={handleSave} className="px-5 py-2 text-sm font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors">Save Part</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
