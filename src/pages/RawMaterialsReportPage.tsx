import { useState, useEffect } from 'react';
import { Calendar, Download, RefreshCw, Package, TrendingUp, TrendingDown, AlertTriangle, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase';
import StatCard from '../components/ui/StatCard';
import type { ReconRawMaterial } from '../types/reconciliation';
import { MONTH_NAMES } from '../types/reconciliation';

interface Branch {
  id: string;
  name: string;
}

interface PeriodInfo {
  id: string;
  month: number;
  year: number;
  status: string;
  branches?: { name: string };
}

function VariancePill({ value }: { value: number }) {
  if (value === 0) return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">0</span>;
  if (Math.abs(value) <= 10) return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">{value > 0 ? '+' : ''}{value.toLocaleString()}</span>;
  return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700">{value > 0 ? '+' : ''}{value.toLocaleString()}</span>;
}

function VarPctPill({ value }: { value: number }) {
  if (Math.abs(value) < 0.01) return <span className="text-xs text-emerald-600 font-medium">0.00%</span>;
  const cls = Math.abs(value) <= 5 ? 'text-amber-600' : 'text-red-600';
  return <span className={`text-xs font-medium ${cls}`}>{value > 0 ? '+' : ''}{value.toFixed(2)}%</span>;
}

export default function RawMaterialsReportPage() {
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [period, setPeriod] = useState<PeriodInfo | null>(null);
  const [minivitsRows, setMinivitsRows] = useState<ReconRawMaterial[]>([]);
  const [bulkRows, setBulkRows] = useState<ReconRawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  useEffect(() => {
    supabase.from('branches').select('id, name').order('name').then(({ data }) => {
      setBranches(data || []);
    });
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      let query = supabase
        .from('reconciliation_periods')
        .select('id, month, year, status, branches(name)')
        .eq('month', selectedMonth)
        .eq('year', selectedYear);

      if (selectedBranch) query = query.eq('branch_id', selectedBranch);

      const { data: periods } = await query.order('created_at', { ascending: false }).limit(1);
      const found = periods?.[0] as PeriodInfo | undefined;
      setPeriod(found || null);

      if (!found) {
        setMinivitsRows([]);
        setBulkRows([]);
        setLoading(false);
        setLastRefresh(new Date());
        return;
      }

      const { data: rm } = await supabase
        .from('recon_raw_materials')
        .select('*')
        .eq('period_id', found.id)
        .order('material_name');

      const rows = (rm || []) as ReconRawMaterial[];
      setMinivitsRows(rows.filter(r => r.material_type === 'minivits'));
      setBulkRows(rows.filter(r => r.material_type === 'bulk'));
    } catch (err) {
      console.error('Error fetching RM report:', err);
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }

  useEffect(() => { fetchData(); }, [selectedMonth, selectedYear, selectedBranch]);

  const allRows = [...minivitsRows, ...bulkRows];

  const totals = allRows.reduce((acc, r) => ({
    opening: acc.opening + r.opening_stock,
    receipts: acc.receipts + r.stock_receipts,
    total: acc.total + r.total,
    issues: acc.issues + r.issues,
    physical: acc.physical + r.physical_stock,
    system: acc.system + r.system_stock,
    variance: acc.variance + r.material_variance,
  }), { opening: 0, receipts: 0, total: 0, issues: 0, physical: 0, system: 0, variance: 0 });

  const withVariance = allRows.filter(r => r.material_variance !== 0).length;
  const criticalVariance = allRows.filter(r => Math.abs(r.material_variance) > 10).length;

  const exportToCSV = () => {
    const headers = ['Type', 'Material', 'Sage Code', 'Opening Stock', 'Receipts', 'Total', 'Issues to Prod', 'Physical Stock', 'System Stock', 'Variance', 'Variance %', 'Comments'];
    const rows = allRows.map(r => [
      r.material_type === 'minivits' ? 'Minivits' : 'Bulk',
      r.material_name,
      r.sage_code || '',
      r.opening_stock,
      r.stock_receipts,
      r.total,
      r.issues,
      r.physical_stock,
      r.system_stock,
      r.material_variance,
      `${r.variance_pct.toFixed(2)}%`,
      r.comments || '',
    ]);
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `raw-materials-report-${MONTH_NAMES[selectedMonth - 1]}-${selectedYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  function SectionTable({ rows, title }: { rows: ReconRawMaterial[]; title: string }) {
    if (rows.length === 0) return null;
    const t = rows.reduce((acc, r) => ({
      opening: acc.opening + r.opening_stock,
      receipts: acc.receipts + r.stock_receipts,
      total: acc.total + r.total,
      issues: acc.issues + r.issues,
      physical: acc.physical + r.physical_stock,
      system: acc.system + r.system_stock,
      variance: acc.variance + r.material_variance,
    }), { opening: 0, receipts: 0, total: 0, issues: 0, physical: 0, system: 0, variance: 0 });

    return (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-3 border-b border-slate-200 bg-slate-50">
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">{title}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 min-w-[180px]">Material</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 whitespace-nowrap">Sage Code</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 whitespace-nowrap">Opening Stock</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 whitespace-nowrap">Receipts</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 whitespace-nowrap">Total</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 whitespace-nowrap">Issued to Prod</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 whitespace-nowrap">Physical Stock</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 whitespace-nowrap">System Stock</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 whitespace-nowrap">Variance</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 whitespace-nowrap">Var %</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Comments</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((item) => (
                <tr key={item.id} className={`hover:bg-slate-50 ${Math.abs(item.material_variance) > 10 ? 'bg-red-50/30' : ''}`}>
                  <td className="px-4 py-3 font-medium text-slate-800">{item.material_name}</td>
                  <td className="px-4 py-3">
                    {item.sage_code ? <span className="font-mono text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded">{item.sage_code}</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{item.opening_stock.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{item.stock_receipts.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{item.total.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-700">{item.issues.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-teal-700">{item.physical_stock.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{item.system_stock.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right"><VariancePill value={item.material_variance} /></td>
                  <td className="px-4 py-3 text-right"><VarPctPill value={item.variance_pct} /></td>
                  <td className="px-4 py-3 text-xs text-slate-500 max-w-[140px] truncate">{item.comments}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 border-t-2 border-slate-300 font-semibold text-slate-700">
                <td className="px-4 py-3">TOTALS</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right tabular-nums">{t.opening.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{t.receipts.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums">{t.total.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums text-amber-700">{t.issues.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums text-teal-700">{t.physical.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums">{t.system.toLocaleString()}</td>
                <td className="px-4 py-3 text-right"><VariancePill value={t.variance} /></td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Raw Materials Stock Report</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {period
              ? `${MONTH_NAMES[period.month - 1]} ${period.year} · ${period.branches?.name ?? 'All Branches'} · Status: ${period.status}`
              : 'Reconciliation-based stock movement report'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Refreshed {lastRefresh.toLocaleTimeString()}</span>
          <button onClick={exportToCSV} disabled={allRows.length === 0}
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
        {branches.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">Branch:</label>
            <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500">
              <option value="">All Branches</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <button onClick={fetchData} disabled={loading}
          className="flex items-center gap-2 px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <RefreshCw className="w-7 h-7 animate-spin text-teal-600" />
        </div>
      )}

      {/* No period found */}
      {!loading && !period && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-6 py-10 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <p className="text-base font-semibold text-amber-800">No reconciliation period found for {MONTH_NAMES[selectedMonth - 1]} {selectedYear}</p>
          <p className="text-sm text-amber-600 mt-1">Create a reconciliation period first, then enter physical stock counts.</p>
          <a href="/reconciliation" className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors">
            <ExternalLink className="w-4 h-4" /> Go to Reconciliation
          </a>
        </div>
      )}

      {/* Summary Cards */}
      {!loading && period && allRows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard title="Opening Stock" value={totals.opening.toLocaleString() + ' kg'} icon={Package} color="teal" />
          <StatCard title="Total Receipts" value={totals.receipts.toLocaleString() + ' kg'} icon={TrendingUp} color="emerald" />
          <StatCard title="Total Issues" value={totals.issues.toLocaleString() + ' kg'} icon={TrendingDown} color="amber" />
          <StatCard
            title="Closing Stock"
            value={(totals.opening + totals.receipts - totals.issues).toLocaleString() + ' kg'}
            icon={AlertTriangle}
            color={criticalVariance > 0 ? 'red' : 'slate'}
          />
        </div>
      )}

      {/* Tables */}
      {!loading && period && (
        <>
          {minivitsRows.length === 0 && bulkRows.length === 0 ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-6 py-12 text-center">
              <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-500">No raw material rows entered for this period yet.</p>
              <p className="text-xs text-slate-400 mt-1">Go to Reconciliation → {MONTH_NAMES[selectedMonth - 1]} {selectedYear} and add Minivits/Bulk RM rows.</p>
            </div>
          ) : (
            <>
              <SectionTable rows={minivitsRows} title="Minivits Raw Materials" />
              <SectionTable rows={bulkRows} title="Bulk Raw Materials" />

              {/* Grand totals */}
              {minivitsRows.length > 0 && bulkRows.length > 0 && (
                <div className="bg-slate-900 text-white rounded-xl px-6 py-4">
                  <div className="grid grid-cols-8 gap-4 text-sm font-semibold">
                    <div className="col-span-2 text-slate-300">GRAND TOTALS</div>
                    <div className="text-right tabular-nums">{totals.opening.toLocaleString()}</div>
                    <div className="text-right tabular-nums text-emerald-400">{totals.receipts.toLocaleString()}</div>
                    <div className="text-right tabular-nums">{totals.issues.toLocaleString()}</div>
                    <div className="text-right tabular-nums text-teal-300">{totals.physical.toLocaleString()}</div>
                    <div className="text-right tabular-nums">{totals.system.toLocaleString()}</div>
                    <div className="text-right tabular-nums">
                      <span className={totals.variance === 0 ? 'text-emerald-400' : Math.abs(totals.variance) <= 10 ? 'text-amber-400' : 'text-red-400'}>
                        {totals.variance > 0 ? '+' : ''}{totals.variance.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Legend */}
      {!loading && allRows.length > 0 && (
        <div className="flex items-center gap-6 text-xs text-slate-500 px-1">
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-100 inline-block" />No variance</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-amber-100 inline-block" />Small variance (&#8804;10 kg)</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-100 inline-block" />Large variance (&gt;10 kg, row highlighted)</div>
        </div>
      )}
    </div>
  );
}
