import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Package, ArrowRightLeft, RefreshCw, Search, Boxes, Warehouse, TrendingUp, TrendingDown, CalendarDays, Filter } from 'lucide-react';
import { format } from 'date-fns';

const WHSE_NAMES: Record<number, string> = {
  18: 'Raw Materials',
  19: 'Production',
  20: 'Finished Goods',
  21: 'Mutare Warehouse',
  17: 'DEB',
};

const EVENT_LABELS: Record<string, string> = {
  production_completed: 'Batch Complete',
  dispatch_delivered: 'Dispatch',
  materials_issued: 'Material Issue',
  grn_confirmed: 'GRN',
  rm_cost_updated: 'RM Cost',
  macropack_manufactured: 'Macropack',
  reconciliation_variance_approved: 'Reconciliation',
};

function fmt(n: number) {
  if (n === 0) return '0';
  return n.toLocaleString('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function whseName(id: number, fallback?: string) {
  return WHSE_NAMES[id] || fallback || `Whse ${id}`;
}

type StockRow = any;
type MovementRow = any;

export default function FinishedGoodsPage() {
  const [stock, setStock] = useState<StockRow[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCode, setSelectedCode] = useState<string>('all');
  const [eventFilter, setEventFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const fetchData = async () => {
    setLoading(true);
    const [stockRes, moveRes] = await Promise.all([
      supabase
        .from('v_sage_stock_for_validation')
        .select('*')
        .is('raw_material_id', null)
        .order('raw_material_name'),
      supabase
        .from('sage_posting_reviews')
        .select('*')
        .not('posted_at', 'is', null)
        .order('posted_at', { ascending: false })
        .limit(200),
    ]);
    setStock(stockRes.data || []);
    setMovements(moveRes.data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const codes = useMemo(() => {
    const s = new Set<string>();
    stock.forEach((r) => s.add(r.sage_code));
    movements.forEach((m) => s.add(m.sage_code));
    return Array.from(s).sort();
  }, [stock, movements]);

  const eventTypes = useMemo(() => {
    return Array.from(new Set(movements.map((m) => m.event_type))).sort();
  }, [movements]);

  const filteredStock = useMemo(() => {
    const term = search.trim().toLowerCase();
    return stock.filter((r) => {
      if (!term) return true;
      return (
        (r.raw_material_name || '').toLowerCase().includes(term) ||
        (r.sage_code || '').toLowerCase().includes(term) ||
        whseName(r.warehouse_id, r.warehouse_name).toLowerCase().includes(term)
      );
    });
  }, [stock, search]);

  const filteredMovements = useMemo(() => {
    const term = search.trim().toLowerCase();
    return movements.filter((m) => {
      if (selectedCode !== 'all' && m.sage_code !== selectedCode) return false;
      if (eventFilter !== 'all' && m.event_type !== eventFilter) return false;
      if (!term) return true;
      const label = EVENT_LABELS[m.event_type] || m.event_type || '';
      return (
        (m.sage_code || '').toLowerCase().includes(term) ||
        (m.reference || '').toLowerCase().includes(term) ||
        (m.description || '').toLowerCase().includes(term) ||
        label.toLowerCase().includes(term)
      );
    });
  }, [movements, selectedCode, eventFilter, search]);

  const stats = useMemo(() => {
    const total = filteredStock.reduce((sum, r) => sum + Number(r.sage_quantity || 0), 0);
    const pd = filteredStock.filter((r) => r.warehouse_id === 19).reduce((sum, r) => sum + Number(r.sage_quantity || 0), 0);
    const deb = filteredStock.filter((r) => r.warehouse_id === 17).reduce((sum, r) => sum + Number(r.sage_quantity || 0), 0);
    const products = new Set(filteredStock.map((r) => r.sage_code)).size;
    return { total, pd, deb, products };
  }, [filteredStock]);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <Package className="w-7 h-7 text-teal-600" />
              Finished Goods & Transfers
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              FG stock per warehouse and the Sage movements that created the transfers.
            </p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 disabled:opacity-60 transition-colors text-sm font-medium"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {/* Summary cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 flex items-center gap-4">
            <div className="p-3 bg-teal-50 rounded-full">
              <Boxes className="w-6 h-6 text-teal-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase">Total FG Qty</p>
              <p className="text-2xl font-bold text-slate-800">{fmt(stats.total)} kg</p>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 flex items-center gap-4">
            <div className="p-3 bg-emerald-50 rounded-full">
              <Warehouse className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase">PD Stock</p>
              <p className="text-2xl font-bold text-slate-800">{fmt(stats.pd)} kg</p>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 flex items-center gap-4">
            <div className="p-3 bg-blue-50 rounded-full">
              <TrendingUp className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase">DEB Stock</p>
              <p className="text-2xl font-bold text-slate-800">{fmt(stats.deb)} kg</p>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 flex items-center gap-4">
            <div className="p-3 bg-violet-50 rounded-full">
              <CalendarDays className="w-6 h-6 text-violet-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase">FG Products</p>
              <p className="text-2xl font-bold text-slate-800">{stats.products}</p>
            </div>
          </div>
        </section>

        {/* Stock summary */}
        <section className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-teal-600" />
              <h2 className="font-semibold text-slate-800">Finished Goods Stock</h2>
              <span className="ml-2 text-xs font-medium text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{filteredStock.length} rows</span>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search product, code or warehouse..."
                className="pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 w-64"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Product</th>
                  <th className="text-left px-4 py-2 font-medium">Sage Code</th>
                  <th className="text-left px-4 py-2 font-medium">Warehouse</th>
                  <th className="text-right px-4 py-2 font-medium">Quantity (kg)</th>
                  <th className="text-left px-4 py-2 font-medium">Last Synced</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredStock.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                      {loading ? 'Loading…' : 'No finished goods stock found.'}
                    </td>
                  </tr>
                ) : (
                  filteredStock.map((row, idx) => (
                    <tr key={`${row.sage_code}-${row.warehouse_id}-${idx}`} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedCode(row.sage_code)}>
                      <td className="px-4 py-2 font-medium text-slate-800">{row.raw_material_name || '—'}</td>
                      <td className="px-4 py-2 font-mono text-slate-600">{row.sage_code}</td>
                      <td className="px-4 py-2 text-slate-700">
                        {whseName(row.warehouse_id, row.warehouse_name)}
                        <span className="ml-2 text-xs text-slate-400 font-mono">({row.warehouse_id})</span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-slate-700">{fmt(Number(row.sage_quantity || 0))}</td>
                      <td className="px-4 py-2 text-slate-500">
                        {row.last_synced_at ? format(new Date(row.last_synced_at), 'yyyy-MM-dd HH:mm') : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Movements */}
        <section className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-teal-600" />
              <h2 className="font-semibold text-slate-800">Sage Movements / Transfers</h2>
              <span className="ml-2 text-xs font-medium text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
                {filteredMovements.length} rows
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative hidden sm:block">
                <Filter className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search movements..."
                  className="pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 w-64"
                />
              </div>
              <select
                value={selectedCode}
                onChange={(e) => setSelectedCode(e.target.value)}
                className="text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
              >
                <option value="all">All sage codes</option>
                {codes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                className="text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
              >
                <option value="all">All events</option>
                {eventTypes.map((t) => (
                  <option key={t} value={t}>
                    {EVENT_LABELS[t] || t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Posted</th>
                  <th className="text-left px-4 py-2 font-medium">Event</th>
                  <th className="text-left px-4 py-2 font-medium">Sage Code</th>
                  <th className="text-left px-4 py-2 font-medium">Tx</th>
                  <th className="text-right px-4 py-2 font-medium">Qty (kg)</th>
                  <th className="text-left px-4 py-2 font-medium">Warehouse</th>
                  <th className="text-left px-4 py-2 font-medium">Reference</th>
                  <th className="text-left px-4 py-2 font-medium">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMovements.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                      {loading ? 'Loading…' : 'No posted movements match the filter.'}
                    </td>
                  </tr>
                ) : (
                  filteredMovements.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 text-slate-600 whitespace-nowrap">
                        {m.posted_at ? format(new Date(m.posted_at), 'yyyy-MM-dd HH:mm') : '—'}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            m.event_type === 'production_completed'
                              ? 'bg-emerald-100 text-emerald-700'
                              : m.event_type === 'dispatch_delivered'
                              ? 'bg-blue-100 text-blue-700'
                              : m.event_type === 'materials_issued'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {EVENT_LABELS[m.event_type] || m.event_type}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-slate-600">{m.sage_code}</td>
                      <td className="px-4 py-2 font-mono text-slate-700">{m.sage_tx_code}</td>
                      <td className="px-4 py-2 text-right font-mono">
                        <span
                          className={`inline-flex items-center gap-1 ${
                            m.sage_tx_code === 'MFDR' ? 'text-rose-700' : 'text-emerald-700'
                          }`}
                        >
                          {m.sage_tx_code === 'MFDR' ? (
                            <TrendingDown className="w-3.5 h-3.5" />
                          ) : (
                            <TrendingUp className="w-3.5 h-3.5" />
                          )}
                          {m.sage_tx_code === 'MFDR' ? fmt(-Number(m.quantity)) : `+${fmt(Number(m.quantity))}`}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-700">{whseName(m.warehouse_id, m.warehouse_code)}</td>
                      <td className="px-4 py-2 font-mono text-slate-500">{m.reference || '—'}</td>
                      <td className="px-4 py-2 text-slate-700 max-w-xs truncate" title={m.description || ''}>
                        {m.description || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
