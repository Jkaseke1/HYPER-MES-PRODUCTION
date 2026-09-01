import { useState, useEffect, useMemo } from 'react';
import { BarChart3, TrendingUp, DollarSign, Package, Download, Filter } from 'lucide-react';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { supabase } from '../lib/supabase';
import type { ProductionOrder, RawMaterial } from '../types/database';
import StatusBadge from '../components/ui/StatusBadge';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';

type Tab = 'production' | 'variance' | 'costing' | 'inventory';
const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'production', label: 'Production', icon: <BarChart3 className="w-4 h-4" /> },
  { key: 'variance', label: 'Variance', icon: <TrendingUp className="w-4 h-4" /> },
  { key: 'costing', label: 'Costing', icon: <DollarSign className="w-4 h-4" /> },
  { key: 'inventory', label: 'Inventory', icon: <Package className="w-4 h-4" /> },
];
const PIE_COLORS = ['#0d9488', '#d97706', '#f59e0b', '#64748b'];
const BAR_COLORS = { planned: '#64748b', actual: '#0d9488' };

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('production');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [orders, setOrders] = useState<(ProductionOrder & { formulations: { name: string; code: string } })[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [oRes, mRes] = await Promise.all([
        supabase
          .from('production_orders')
          .select('*, formulations(name, code)')
          .gte('created_at', startDate)
          .lte('created_at', endDate + 'T23:59:59')
          .order('created_at', { ascending: false }),
        supabase.from('raw_materials').select('*').eq('is_active', true),
      ]);
      setOrders((oRes.data as any) || []);
      setMaterials((mRes.data as any) || []);
      setLoading(false);
    }
    load();
  }, [startDate, endDate]);

  useRealtimeRefresh('reports-dashboard-live', ['production_orders', 'raw_materials'], async () => {
    const [oRes, mRes] = await Promise.all([
      supabase
        .from('production_orders')
        .select('*, formulations(name, code)')
        .gte('created_at', startDate)
        .lte('created_at', endDate + 'T23:59:59')
        .order('created_at', { ascending: false }),
      supabase.from('raw_materials').select('*').eq('is_active', true),
    ]);
    setOrders((oRes.data as any) || []);
    setMaterials((mRes.data as any) || []);
  });

  const productionByFormulation = useMemo(() => {
    const map: Record<string, number> = {};
    orders.forEach((o) => {
      const name = o.formulations?.name || 'Unknown';
      map[name] = (map[name] || 0) + o.actual_qty;
    });
    return Object.entries(map).map(([name, qty]) => ({ name, qty }));
  }, [orders]);

  const completedOrders = orders.filter((o) => o.status === 'completed');
  const totalProduced = orders.reduce((s, o) => s + o.actual_qty, 0);
  const avgBatch = orders.length ? totalProduced / orders.length : 0;

  const costAgg = useMemo(() => [
    { name: 'Raw Material', value: orders.reduce((s, o) => s + o.raw_material_cost, 0) },
    { name: 'Labour', value: orders.reduce((s, o) => s + o.labour_cost, 0) },
    { name: 'Machine', value: orders.reduce((s, o) => s + o.machine_cost, 0) },
    { name: 'Overhead', value: orders.reduce((s, o) => s + o.overhead_cost, 0) },
  ], [orders]);

  const topMaterials = useMemo(() =>
    [...materials]
      .map((m) => ({ ...m, totalValue: m.current_stock * m.cost_per_unit }))
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 10),
  [materials]);

  const varianceData = useMemo(() =>
    orders.slice(0, 12).map((o) => ({
      name: o.batch_number,
      planned: o.planned_qty,
      actual: o.actual_qty,
    })),
  [orders]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports & Analytics</h1>
          <p className="text-sm text-slate-500 mt-1">Manufacturing performance insights</p>
        </div>
        <button className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors">
          <Download className="w-4 h-4" /> Export Report
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-200">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Filter className="w-4 h-4" /> Filters
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600">From</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600">To</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
        </div>
      </div>

      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === t.key ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>
      ) : (
        <>
          {tab === 'production' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { label: 'Total Produced', value: fmt(totalProduced), color: 'text-teal-700' },
                  { label: 'Orders Completed', value: completedOrders.length, color: 'text-teal-700' },
                  { label: 'Avg Batch Size', value: fmt(avgBatch), color: 'text-amber-700' },
                ].map((s) => (
                  <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-5">
                    <p className="text-sm text-slate-500">{s.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Production by Formulation</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={productionByFormulation}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="qty" name="Quantity" fill="#0d9488" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600"><tr>
                    {['Batch Number', 'Formulation', 'Planned Qty', 'Actual Qty', 'Efficiency %', 'Date'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {orders.map((o) => (
                      <tr key={o.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">{o.batch_number}</td>
                        <td className="px-4 py-3 text-slate-700">{o.formulations?.name}</td>
                        <td className="px-4 py-3 text-slate-700">{fmt(o.planned_qty)}</td>
                        <td className="px-4 py-3 text-slate-700">{fmt(o.actual_qty)}</td>
                        <td className="px-4 py-3 text-slate-700">{o.planned_qty ? fmt((o.actual_qty / o.planned_qty) * 100) + '%' : '-'}</td>
                        <td className="px-4 py-3 text-slate-500">{new Date(o.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'variance' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Planned vs Actual (Recent Orders)</h3>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={varianceData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fontSize: 12 }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="planned" name="Planned" fill={BAR_COLORS.planned} radius={[0, 4, 4, 0]} />
                    <Bar dataKey="actual" name="Actual" fill={BAR_COLORS.actual} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600"><tr>
                    {['Batch Number', 'Formulation', 'Planned Qty', 'Actual Qty', 'Variance (qty)', 'Variance (%)', 'Status'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {orders.map((o) => {
                      const vQty = o.actual_qty - o.planned_qty;
                      const vPct = o.planned_qty ? (vQty / o.planned_qty) * 100 : 0;
                      const badge = vQty >= 0 ? 'over' : 'under';
                      return (
                        <tr key={o.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-900">{o.batch_number}</td>
                          <td className="px-4 py-3 text-slate-700">{o.formulations?.name}</td>
                          <td className="px-4 py-3 text-slate-700">{fmt(o.planned_qty)}</td>
                          <td className="px-4 py-3 text-slate-700">{fmt(o.actual_qty)}</td>
                          <td className={`px-4 py-3 font-medium ${vQty >= 0 ? 'text-teal-700' : 'text-red-600'}`}>{vQty >= 0 ? '+' : ''}{fmt(vQty)}</td>
                          <td className={`px-4 py-3 font-medium ${vPct >= 0 ? 'text-teal-700' : 'text-red-600'}`}>{vPct >= 0 ? '+' : ''}{fmt(vPct)}%</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full border ${badge === 'over' ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                              {badge === 'over' ? 'Over' : 'Under'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'costing' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Cost Breakdown</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={costAgg} cx="50%" cy="50%" outerRadius={110} dataKey="value" nameKey="name" label={(props: { name?: string; percent?: number }) => `${props.name ?? ''} ${((props.percent ?? 0) * 100).toFixed(1)}%`}>
                      {costAgg.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => fmt(Number(v))} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600"><tr>
                    {['Batch Number', 'Formulation', 'Raw Material', 'Labour', 'Machine', 'Overhead', 'Total Cost', 'Cost/Unit'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {orders.map((o) => (
                      <tr key={o.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">{o.batch_number}</td>
                        <td className="px-4 py-3 text-slate-700">{o.formulations?.name}</td>
                        <td className="px-4 py-3 text-slate-700">{fmt(o.raw_material_cost)}</td>
                        <td className="px-4 py-3 text-slate-700">{fmt(o.labour_cost)}</td>
                        <td className="px-4 py-3 text-slate-700">{fmt(o.machine_cost)}</td>
                        <td className="px-4 py-3 text-slate-700">{fmt(o.overhead_cost)}</td>
                        <td className="px-4 py-3 font-medium text-slate-900">{fmt(o.total_cost)}</td>
                        <td className="px-4 py-3 text-slate-700">{fmt(o.cost_per_unit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'inventory' && (
            <div className="space-y-6">
              {/* Quick Report Links Card */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <a
                  href="/warehouse"
                  className="p-4 bg-white rounded-xl border border-slate-200 hover:border-teal-500 hover:shadow-md transition-all group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="p-2 bg-teal-50 text-teal-700 rounded-lg group-hover:bg-teal-600 group-hover:text-white transition-colors">
                      <Package className="w-5 h-5" />
                    </span>
                    <span className="text-[10px] font-bold text-teal-600 uppercase tracking-wider">Live Log</span>
                  </div>
                  <h4 className="font-bold text-slate-900 text-sm">Stock Movements</h4>
                  <p className="text-xs text-slate-500 mt-1">Real-time additions & deductions per warehouse</p>
                </a>

                <a
                  href="/reports/rm-reconciliation"
                  className="p-4 bg-white rounded-xl border border-slate-200 hover:border-amber-500 hover:shadow-md transition-all group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="p-2 bg-amber-50 text-amber-700 rounded-lg group-hover:bg-amber-600 group-hover:text-white transition-colors">
                      <TrendingUp className="w-5 h-5" />
                    </span>
                    <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Monthly Audit</span>
                  </div>
                  <h4 className="font-bold text-slate-900 text-sm">RM Reconciliation</h4>
                  <p className="text-xs text-slate-500 mt-1">Opening balance + receipts - issues vs stock count</p>
                </a>

                <a
                  href="/rm-receipts-matrix"
                  className="p-4 bg-white rounded-xl border border-slate-200 hover:border-indigo-500 hover:shadow-md transition-all group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="p-2 bg-indigo-50 text-indigo-700 rounded-lg group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                      <BarChart3 className="w-5 h-5" />
                    </span>
                    <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Arrivals</span>
                  </div>
                  <h4 className="font-bold text-slate-900 text-sm">Receipts & Issues Matrix</h4>
                  <p className="text-xs text-slate-500 mt-1">Daily matrix of additions (GRN) and deductions (floor)</p>
                </a>

                <a
                  href="/sage-posting-review"
                  className="p-4 bg-white rounded-xl border border-slate-200 hover:border-purple-500 hover:shadow-md transition-all group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="p-2 bg-purple-50 text-purple-700 rounded-lg group-hover:bg-purple-600 group-hover:text-white transition-colors">
                      <DollarSign className="w-5 h-5" />
                    </span>
                    <span className="text-[10px] font-bold text-purple-600 uppercase tracking-wider">Sage Audit</span>
                  </div>
                  <h4 className="font-bold text-slate-900 text-sm">Sage Posting Review</h4>
                  <p className="text-xs text-slate-500 mt-1">Audit log of all Sage postings across all warehouses</p>
                </a>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Top 10 Raw Materials by Stock Value</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={topMaterials}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v) => fmt(Number(v))} />
                    <Bar dataKey="totalValue" name="Stock Value" fill="#d97706" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600"><tr>
                    {['Material', 'Current Stock', 'Unit', 'Cost/Unit', 'Total Value', 'Reorder Level', 'Status'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {materials.map((m) => {
                      const status = m.current_stock <= m.reorder_level ? 'low' : 'operational';
                      return (
                        <tr key={m.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-900">{m.name}</td>
                          <td className="px-4 py-3 text-slate-700">{fmt(m.current_stock)}</td>
                          <td className="px-4 py-3 text-slate-500">{m.unit}</td>
                          <td className="px-4 py-3 text-slate-700">{fmt(m.cost_per_unit)}</td>
                          <td className="px-4 py-3 font-medium text-slate-900">{fmt(m.current_stock * m.cost_per_unit)}</td>
                          <td className="px-4 py-3 text-slate-700">{fmt(m.reorder_level)}</td>
                          <td className="px-4 py-3"><StatusBadge status={status === 'low' ? 'urgent' : 'active'} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
