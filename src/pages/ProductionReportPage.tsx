import { useState, useEffect } from 'react';
import { Calendar, Download, RefreshCw, Package, Activity, BarChart3, Percent } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line
} from 'recharts';
import { supabase } from '../lib/supabase';
import StatCard from '../components/ui/StatCard';
import { MONTH_NAMES } from '../types/reconciliation';

interface ProductionRow {
  formulation_name: string;
  sage_code: string;
  batches_count: number;
  planned_qty: number;
  actual_qty: number;
  variance: number;
  variance_pct: number;
}

interface DailyData {
  day: string;
  tonnage: number;
}

export default function ProductionReportPage() {
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<ProductionRow[]>([]);
  const [dailyData, setDailyData] = useState<DailyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  async function fetchData() {
    setLoading(true);
    try {
      const startDate = new Date(selectedYear, selectedMonth - 1, 1);
      const endDate = new Date(selectedYear, selectedMonth, 0, 23, 59, 59);

      const { data: orders, error } = await supabase
        .from('production_orders')
        .select(`id, planned_qty, actual_qty, created_at, formulations!inner(id, name, sage_code)`)
        .eq('status', 'completed')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .order('created_at');

      if (error) throw error;

      const map = new Map<string, ProductionRow>();
      const dayMap = new Map<string, number>();

      orders?.forEach(order => {
        const f = order.formulations as any;
        const key = f.sage_code;
        const planned = order.planned_qty || 0;
        const actual = order.actual_qty || 0;
        const existing = map.get(key) || {
          formulation_name: f.name,
          sage_code: key,
          batches_count: 0,
          planned_qty: 0,
          actual_qty: 0,
          variance: 0,
          variance_pct: 0,
        };
        existing.batches_count += 1;
        existing.planned_qty += planned;
        existing.actual_qty += actual;
        map.set(key, existing);

        const day = order.created_at.slice(0, 10);
        dayMap.set(day, (dayMap.get(day) || 0) + actual / 1000);
      });

      const processed = Array.from(map.values()).map(r => {
        r.variance = r.actual_qty - r.planned_qty;
        r.variance_pct = r.planned_qty > 0 ? (r.variance / r.planned_qty) * 100 : 0;
        return r;
      }).sort((a, b) => b.actual_qty - a.actual_qty);

      setRows(processed);

      const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
      const daily: DailyData[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const key = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        daily.push({ day: String(d), tonnage: +(dayMap.get(key) || 0).toFixed(2) });
      }
      setDailyData(daily);
    } catch (err) {
      console.error('Error fetching production report:', err);
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }

  useEffect(() => { fetchData(); }, [selectedMonth, selectedYear]);

  const totalBatches = rows.reduce((s, r) => s + r.batches_count, 0);
  const totalActualKg = rows.reduce((s, r) => s + r.actual_qty, 0);
  const totalTonnage = totalActualKg / 1000;
  const avgBatchSize = totalBatches > 0 ? totalActualKg / totalBatches / 1000 : 0;
  const totalPlanned = rows.reduce((s, r) => s + r.planned_qty, 0);
  const completionRate = totalPlanned > 0 ? (totalActualKg / totalPlanned) * 100 : 0;

  const top10 = [...rows]
    .sort((a, b) => b.actual_qty - a.actual_qty)
    .slice(0, 10)
    .map(r => ({ name: r.sage_code, tonnage: +(r.actual_qty / 1000).toFixed(2) }));

  const exportToCSV = () => {
    const headers = ['Formulation Name', 'Sage Code', 'Batches', 'Planned Qty (kg)', 'Actual Qty (kg)', 'Variance (kg)', 'Variance %'];
    const csvRows = rows.map(r => [
      `"${r.formulation_name}"`, r.sage_code, r.batches_count,
      r.planned_qty, r.actual_qty, r.variance, r.variance_pct.toFixed(2) + '%'
    ]);
    const csv = [headers, ...csvRows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `production-report-${MONTH_NAMES[selectedMonth - 1]}-${selectedYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Production Report</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {MONTH_NAMES[selectedMonth - 1]} {selectedYear} · Completed production orders
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Refreshed {lastRefresh.toLocaleTimeString()}</span>
          <button onClick={exportToCSV} disabled={rows.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 bg-white border border-slate-200 rounded-xl px-5 py-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400" />
          <label className="text-sm font-medium text-slate-600">Month:</label>
          <select value={selectedMonth} onChange={e => setSelectedMonth(parseInt(e.target.value))}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500">
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Year:</label>
          <select value={selectedYear} onChange={e => setSelectedYear(parseInt(e.target.value))}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500">
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button onClick={fetchData} disabled={loading}
          className="flex items-center gap-2 px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Total Batches" value={totalBatches.toLocaleString()} icon={Package} color="teal" />
        <StatCard title="Total Tonnage" value={totalTonnage.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' T'} icon={Activity} color="emerald" />
        <StatCard title="Avg Batch Size" value={avgBatchSize.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' T'} icon={BarChart3} color="blue" />
        <StatCard
          title="Completion Rate"
          value={completionRate.toFixed(1) + '%'}
          icon={Percent}
          color={completionRate >= 95 ? 'emerald' : completionRate >= 80 ? 'amber' : 'red'}
        />
      </div>

      {/* Production Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Production by Formulation</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Formulation Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Sage Code</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Batches</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Planned Qty (kg)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Actual Qty (kg)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Variance (kg)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Variance %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-20 text-center">
                    <RefreshCw className="w-6 h-6 animate-spin text-teal-600 mx-auto" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-20 text-center text-slate-500">
                    <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No completed production orders for {MONTH_NAMES[selectedMonth - 1]} {selectedYear}</p>
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{row.formulation_name}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded">{row.sage_code}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.batches_count}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.planned_qty.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{row.actual_qty.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={`font-medium ${row.variance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {row.variance >= 0 ? '+' : ''}{row.variance.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={`font-medium ${row.variance_pct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {row.variance_pct >= 0 ? '+' : ''}{row.variance_pct.toFixed(2)}%
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="bg-slate-100 border-t-2 border-slate-300 font-semibold text-slate-700">
                  <td className="px-4 py-3" colSpan={2}>TOTALS</td>
                  <td className="px-4 py-3 text-right tabular-nums">{totalBatches}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{totalPlanned.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{totalActualKg.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className={totalActualKg - totalPlanned >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                      {totalActualKg - totalPlanned >= 0 ? '+' : ''}{(totalActualKg - totalPlanned).toLocaleString()}
                    </span>
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar Chart — Top 10 Formulations */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-base font-semibold text-slate-800 mb-4">Top 10 Formulations by Tonnage</h3>
          {top10.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={top10} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => v + 'T'} />
                <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [v + ' T', 'Tonnage']} />
                <Bar dataKey="tonnage" fill="#0d9488" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
              {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'No data for this month'}
            </div>
          )}
        </div>

        {/* Line Chart — Daily Production Trend */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-base font-semibold text-slate-800 mb-4">Daily Production Trend (Tonnes)</h3>
          {dailyData.some(d => d.tonnage > 0) ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={dailyData} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => v + 'T'} />
                <Tooltip formatter={(v: number) => [v + ' T', 'Tonnes']} />
                <Line type="monotone" dataKey="tonnage" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
              {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'No production data for this month'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
