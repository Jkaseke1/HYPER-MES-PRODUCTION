import { useState, useEffect, useMemo } from 'react';
import { Plus, Search, DollarSign, History, TrendingUp, Package } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/ui/Modal';
import StatCard from '../components/ui/StatCard';

interface RawMaterial {
  id: string;
  code: string;
  name: string;
  category: string;
  cost_per_unit: number;
}

interface CostEntry {
  id: string;
  raw_material_id: string;
  effective_date: string;
  cost_per_tonne_usd: number;
  source: string;
  grn_id: string | null;
  usd_zig_rate: number | null;
  created_by: string | null;
  created_at: string;
}

interface RateEntry {
  id: string;
  effective_date: string;
  rate: number;
  set_by: string | null;
  created_at: string;
}

interface MaterialWithCost {
  id: string;
  code: string;
  name: string;
  category: string;
  latestCost: number | null;
  effectiveDate: string | null;
  source: string | null;
}

const SOURCE_OPTIONS = ['GRN', 'MANUAL', 'SAGE_SYNC'] as const;
const SOURCE_LABELS: Record<string, string> = {
  GRN: 'GRN',
  MANUAL: 'Manual',
  SAGE_SYNC: 'Sage Sync',
};
const SOURCE_STYLES: Record<string, string> = {
  GRN: 'bg-blue-50 text-blue-700 border-blue-200',
  MANUAL: 'bg-amber-50 text-amber-700 border-amber-200',
  SAGE_SYNC: 'bg-purple-50 text-purple-700 border-purple-200',
};

const emptyRateForm = {
  raw_material_id: '',
  cost_per_tonne_usd: '',
  effective_date: new Date().toISOString().split('T')[0],
  source: 'MANUAL' as string,
  usd_zig_rate: '',
};

const emptyExchangeForm = {
  effective_date: new Date().toISOString().split('T')[0],
  rate: '',
};

export default function RMCostRegisterPage() {
  useAuth();
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [costEntries, setCostEntries] = useState<CostEntry[]>([]);
  const [rateHistory, setRateHistory] = useState<RateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Modals
  const [addRateModalOpen, setAddRateModalOpen] = useState(false);
  const [exchangeModalOpen, setExchangeModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyMaterial, setHistoryMaterial] = useState<RawMaterial | null>(null);
  const [materialHistory, setMaterialHistory] = useState<CostEntry[]>([]);

  // Forms
  const [rateForm, setRateForm] = useState(emptyRateForm);
  const [exchangeForm, setExchangeForm] = useState(emptyExchangeForm);
  const [saving, setSaving] = useState(false);

  const latestRate = useMemo(() => {
    if (rateHistory.length === 0) return null;
    return rateHistory[0];
  }, [rateHistory]);

  async function fetchData() {
    setLoading(true);
    const [materialsRes, costsRes, ratesRes] = await Promise.all([
      supabase.from('raw_materials').select('id, code, name, category, cost_per_unit').eq('is_active', true).order('code'),
      supabase.from('rm_cost_register').select('*').order('effective_date', { ascending: false }),
      supabase.from('usd_zig_rate_history').select('*').order('effective_date', { ascending: false }),
    ]);
    setMaterials(materialsRes.data || []);
    setCostEntries(costsRes.data || []);
    setRateHistory(ratesRes.data || []);
    setLoading(false);
  }

  useEffect(() => { fetchData(); }, []);

  // Build material list with latest cost
  const materialsWithCost: MaterialWithCost[] = useMemo(() => {
    return materials.map(m => {
      const latest = costEntries.find(c => c.raw_material_id === m.id);
      return {
        id: m.id,
        code: m.code,
        name: m.name,
        category: m.category,
        latestCost: latest ? latest.cost_per_tonne_usd : null,
        effectiveDate: latest ? latest.effective_date : null,
        source: latest ? latest.source : null,
      };
    });
  }, [materials, costEntries]);

  const filtered = useMemo(() => {
    if (!search) return materialsWithCost;
    const q = search.toLowerCase();
    return materialsWithCost.filter(m =>
      m.code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    );
  }, [materialsWithCost, search]);

  // Stats
  const totalMaterials = materials.length;
  const withPricing = materialsWithCost.filter(m => m.latestCost !== null).length;
  const withoutPricing = totalMaterials - withPricing;

  // Add New Rate
  function openAddRate() {
    setRateForm({
      ...emptyRateForm,
      usd_zig_rate: latestRate ? String(latestRate.rate) : '',
    });
    setAddRateModalOpen(true);
  }

  async function handleSaveRate(e: React.FormEvent) {
    e.preventDefault();
    if (!rateForm.raw_material_id || !rateForm.cost_per_tonne_usd) {
      alert('Please fill in all required fields.');
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('rm_cost_register').insert({
        raw_material_id: rateForm.raw_material_id,
        cost_per_tonne_usd: parseFloat(rateForm.cost_per_tonne_usd),
        effective_date: rateForm.effective_date,
        source: rateForm.source,
        usd_zig_rate: rateForm.usd_zig_rate ? parseFloat(rateForm.usd_zig_rate) : null,
        created_by: user?.id || null,
      });
      if (error) throw error;
      setAddRateModalOpen(false);
      fetchData();
    } catch (error: any) {
      console.error('Error saving rate:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  // USD:ZiG Rate
  function openExchangeRate() {
    setExchangeForm(emptyExchangeForm);
    setExchangeModalOpen(true);
  }

  async function handleSaveExchangeRate(e: React.FormEvent) {
    e.preventDefault();
    if (!exchangeForm.rate) {
      alert('Please enter a rate.');
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('usd_zig_rate_history').insert({
        effective_date: exchangeForm.effective_date,
        rate: parseFloat(exchangeForm.rate),
        set_by: user?.id || null,
      });
      if (error) {
        if (error.code === '23505') {
          alert('A rate already exists for this date. Please choose a different date.');
        } else {
          throw error;
        }
      } else {
        setExchangeForm(emptyExchangeForm);
        fetchData();
      }
    } catch (error: any) {
      console.error('Error saving exchange rate:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  // Material History
  async function openHistory(material: RawMaterial) {
    setHistoryMaterial(material);
    setHistoryModalOpen(true);
    const { data } = await supabase
      .from('rm_cost_register')
      .select('*')
      .eq('raw_material_id', material.id)
      .order('effective_date', { ascending: false });
    setMaterialHistory(data || []);
  }

  const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
  const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Raw Material Prices</h1>
          <p className="text-sm text-slate-500 mt-1">Manage raw material costs for batch costing and gross margin calculations</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={openExchangeRate}
            className="flex items-center gap-2 bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            <TrendingUp className="w-4 h-4" />
            USD:ZiG Rate
          </button>
          <button
            onClick={openAddRate}
            className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add New Rate
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard title="Total Materials" value={totalMaterials} icon={Package} />
        <StatCard title="With Pricing" value={withPricing} icon={DollarSign} color="emerald" />
        <StatCard title="No Pricing" value={withoutPricing} icon={Package} color="amber" />
        <StatCard
          title="Current USD:ZiG"
          value={latestRate ? latestRate.rate.toFixed(2) : 'N/A'}
          icon={TrendingUp}
          color="blue"
        />
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search by code or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
        />
      </div>

      {/* Main Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Code</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Raw Material</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Category</th>
                <th className="px-4 py-3 text-right font-medium text-slate-600">Cost/Tonne USD</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Effective Date</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Source</th>
                <th className="px-4 py-3 text-center font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    No materials found
                  </td>
                </tr>
              ) : (
                filtered.map(m => (
                  <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-slate-800">{m.code}</td>
                    <td className="px-4 py-3 text-slate-700">{m.name}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 capitalize">
                        {m.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">
                      {m.latestCost !== null
                        ? `$${m.latestCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
                        : <span className="text-slate-400 font-normal">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {m.effectiveDate
                        ? format(new Date(m.effectiveDate), 'dd MMM yyyy')
                        : <span className="text-slate-400">—</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      {m.source ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${SOURCE_STYLES[m.source] || 'bg-slate-100 text-slate-600'}`}>
                          {SOURCE_LABELS[m.source] || m.source}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => openHistory(materials.find(mat => mat.id === m.id)!)}
                        className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-800 font-medium"
                        title="View price history"
                      >
                        <History className="w-3.5 h-3.5" />
                        History
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add New Rate Modal */}
      <Modal open={addRateModalOpen} onClose={() => setAddRateModalOpen(false)} title="Add New Material Rate">
        <form onSubmit={handleSaveRate} className="space-y-4">
          <div>
            <label className={labelCls}>Raw Material *</label>
            <select
              value={rateForm.raw_material_id}
              onChange={(e) => setRateForm({ ...rateForm, raw_material_id: e.target.value })}
              className={inputCls}
              required
            >
              <option value="">Select raw material</option>
              {materials.map(m => (
                <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Cost per Tonne USD *</label>
              <input
                type="number"
                step="0.0001"
                value={rateForm.cost_per_tonne_usd}
                onChange={(e) => setRateForm({ ...rateForm, cost_per_tonne_usd: e.target.value })}
                className={inputCls}
                placeholder="e.g. 350.00"
                required
              />
            </div>
            <div>
              <label className={labelCls}>Effective Date *</label>
              <input
                type="date"
                value={rateForm.effective_date}
                onChange={(e) => setRateForm({ ...rateForm, effective_date: e.target.value })}
                className={inputCls}
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Source</label>
              <select
                value={rateForm.source}
                onChange={(e) => setRateForm({ ...rateForm, source: e.target.value })}
                className={inputCls}
              >
                {SOURCE_OPTIONS.map(s => (
                  <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>USD:ZiG Rate</label>
              <input
                type="number"
                step="0.0001"
                value={rateForm.usd_zig_rate}
                onChange={(e) => setRateForm({ ...rateForm, usd_zig_rate: e.target.value })}
                className={inputCls}
                placeholder={latestRate ? `Current: ${latestRate.rate}` : 'Enter rate'}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setAddRateModalOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Rate'}
            </button>
          </div>
        </form>
      </Modal>

      {/* USD:ZiG Rate History Modal */}
      <Modal open={exchangeModalOpen} onClose={() => setExchangeModalOpen(false)} title="USD:ZiG Exchange Rate History">
        <div className="space-y-4">
          {/* Current Rate */}
          {latestRate && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-xs text-blue-600 font-medium mb-1">Current Rate</p>
              <p className="text-2xl font-bold text-blue-800">1 USD = {latestRate.rate.toFixed(4)} ZiG</p>
              <p className="text-xs text-blue-500 mt-1">Effective: {format(new Date(latestRate.effective_date), 'dd MMM yyyy')}</p>
            </div>
          )}

          {/* Add New Rate */}
          <form onSubmit={handleSaveExchangeRate} className="flex items-end gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex-1">
              <label className={labelCls}>Effective Date</label>
              <input
                type="date"
                value={exchangeForm.effective_date}
                onChange={(e) => setExchangeForm({ ...exchangeForm, effective_date: e.target.value })}
                className={inputCls}
                required
              />
            </div>
            <div className="flex-1">
              <label className={labelCls}>Rate (ZiG per USD)</label>
              <input
                type="number"
                step="0.0001"
                value={exchangeForm.rate}
                onChange={(e) => setExchangeForm({ ...exchangeForm, rate: e.target.value })}
                className={inputCls}
                placeholder="e.g. 50.0000"
                required
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50 whitespace-nowrap"
            >
              {saving ? 'Saving...' : 'Add Rate'}
            </button>
          </form>

          {/* Rate History Table */}
          <div className="border border-slate-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-slate-600">Effective Date</th>
                  <th className="px-4 py-2 text-right font-medium text-slate-600">Rate (ZiG/USD)</th>
                  <th className="px-4 py-2 text-left font-medium text-slate-600">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rateHistory.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-slate-400">No rates recorded</td>
                  </tr>
                ) : (
                  rateHistory.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 text-slate-700">{format(new Date(r.effective_date), 'dd MMM yyyy')}</td>
                      <td className="px-4 py-2 text-right font-semibold text-slate-800">{r.rate.toFixed(4)}</td>
                      <td className="px-4 py-2 text-xs text-slate-500">{format(new Date(r.created_at), 'dd MMM yyyy HH:mm')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      {/* Material Price History Modal */}
      <Modal open={historyModalOpen} onClose={() => { setHistoryModalOpen(false); setHistoryMaterial(null); }} title={historyMaterial ? `Price History — ${historyMaterial.code} (${historyMaterial.name})` : 'Price History'}>
        <div className="space-y-4">
          {materialHistory.length === 0 ? (
            <div className="text-center text-slate-400 py-8">No price history for this material</div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Effective Date</th>
                    <th className="px-4 py-2 text-right font-medium text-slate-600">Cost/Tonne USD</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Source</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {materialHistory.map(entry => (
                    <tr key={entry.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 text-slate-700">{format(new Date(entry.effective_date), 'dd MMM yyyy')}</td>
                      <td className="px-4 py-2 text-right font-semibold text-slate-800">
                        ${entry.cost_per_tonne_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${SOURCE_STYLES[entry.source] || 'bg-slate-100 text-slate-600'}`}>
                          {SOURCE_LABELS[entry.source] || entry.source}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-500">{format(new Date(entry.created_at), 'dd MMM yyyy HH:mm')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
