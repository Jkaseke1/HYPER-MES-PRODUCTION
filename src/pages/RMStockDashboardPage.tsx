import { useEffect, useMemo, useState } from 'react';
import { format, subDays } from 'date-fns';
import {
  ArrowDownToLine, ArrowUpFromLine, AlertTriangle, Calendar, Filter,
  Download, Plus, ChevronDown, ChevronUp, RefreshCw, Eye, EyeOff,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';

const MATERIAL_NAMES = [
  'Beef Carcass Meal', 'Solvent Soya', 'Full Fat Soya Meal', 'Low Fat Soya Meal',
  'Soya Beans', 'Cotton Seed', 'Cottonseed Meal', 'Sunflower Cake',
  'Sunflower Meal', 'Sunflower Seeds', 'Sesame Seeds', 'Congluten',
  'Maize Yellow', 'Maize White', 'Mealie Meal', 'Millet',
  'Maize Bran', 'Wheat Bran', 'RICE BRAN', 'Sorghum',
  'Mollases', 'Hay Bales', 'Cotton Hulls', 'Cotton cake fuzzy',
  'Lucerne pellets', 'Maltculms', 'Thin Corn', 'Barley Straw',
  'Wheat Straw', 'Sorghum Straw/Pellets', 'Limestone flour', 'Limestone grits',
  'Magnesium Oxide', 'Mono calcium Phosphate', 'Calcium Oxide', 'Salt Fine', 'Salt Course',
];

type SnapshotRow = {
  id: string;
  raw_material_name: string;
  opening_stock: number;
  opening_stock_base_date: string | null;
  mtd_receipts: number;
  total_available: number;
  issues_to_production: number;
  theo_closing_stock: number;
  physical_stock: number;
  system_stock: number;
  stock_variance: number;
  comment: string | null;
};

function fmt(n: number) {
  if (n === 0) return '0';
  return n.toLocaleString('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export default function RMStockDashboardPage() {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hideZeros, setHideZeros] = useState(false);
  const [sortKey, setSortKey] = useState<'name' | 'variance' | 'stock'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showNewSnapshot, setShowNewSnapshot] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('rm_daily_snapshots')
      .select('*')
      .eq('snapshot_date', date)
      .order('raw_material_name');

    const existing = (data as SnapshotRow[]) || [];
    const existingNames = new Set(existing.map((r) => r.raw_material_name));

    // Pad missing materials with zero rows
    const padded = [...existing];
    for (const name of MATERIAL_NAMES) {
      if (!existingNames.has(name)) {
        padded.push({
          id: '',
          raw_material_name: name,
          opening_stock: 0,
          opening_stock_base_date: null,
          mtd_receipts: 0,
          total_available: 0,
          issues_to_production: 0,
          theo_closing_stock: 0,
          physical_stock: 0,
          system_stock: 0,
          stock_variance: 0,
          comment: '',
        });
      }
    }

    setRows(padded.sort((a, b) => a.raw_material_name.localeCompare(b.raw_material_name)));
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [date]);

  useRealtimeRefresh('rm-stock-dashboard-live', ['rm_daily_snapshots'], fetchData);

  const sortedRows = useMemo(() => {
    const r = [...rows];
    r.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.raw_material_name.localeCompare(b.raw_material_name);
      else if (sortKey === 'variance') cmp = Math.abs(b.stock_variance) - Math.abs(a.stock_variance);
      else if (sortKey === 'stock') cmp = b.physical_stock - a.physical_stock;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return r;
  }, [rows, sortKey, sortDir]);

  const visibleRows = useMemo(() => {
    if (!hideZeros) return sortedRows;
    return sortedRows.filter(
      (r) =>
        r.opening_stock !== 0 ||
        r.mtd_receipts !== 0 ||
        r.issues_to_production !== 0 ||
        r.physical_stock !== 0
    );
  }, [sortedRows, hideZeros]);

  const varianceCount = useMemo(
    () => rows.filter((r) => Math.abs(r.stock_variance) > 0.1).length,
    [rows]
  );

  async function updatePhysicalStock(row: SnapshotRow, value: number) {
    if (row.id) {
      await supabase.from('rm_daily_snapshots').update({ physical_stock: value }).eq('id', row.id);
    } else {
      await supabase.from('rm_daily_snapshots').insert({
        snapshot_date: date,
        raw_material_name: row.raw_material_name,
        physical_stock: value,
        opening_stock: 0,
        mtd_receipts: 0,
        issues_to_production: 0,
        system_stock: 0,
      });
    }
    fetchData();
  }

  async function updateComment(row: SnapshotRow, value: string) {
    if (row.id) {
      await supabase.from('rm_daily_snapshots').update({ comment: value }).eq('id', row.id);
    } else {
      await supabase.from('rm_daily_snapshots').insert({
        snapshot_date: date,
        raw_material_name: row.raw_material_name,
        comment: value,
        opening_stock: 0,
        mtd_receipts: 0,
        issues_to_production: 0,
        physical_stock: 0,
        system_stock: 0,
      });
    }
    fetchData();
  }

  async function createSnapshot() {
    const prevDate = format(subDays(new Date(date), 1), 'yyyy-MM-dd');
    const { data: prev } = await supabase
      .from('rm_daily_snapshots')
      .select('*')
      .eq('snapshot_date', prevDate);

    const prevRows = (prev as SnapshotRow[]) || [];
    if (prevRows.length === 0) {
      alert('No snapshot found for ' + prevDate + ' to copy from.');
      return;
    }

    const inserts = prevRows.map((r) => ({
      snapshot_date: date,
      raw_material_name: r.raw_material_name,
      opening_stock: r.physical_stock,
      opening_stock_base_date: r.snapshot_date,
      mtd_receipts: 0,
      issues_to_production: 0,
      physical_stock: r.physical_stock,
      system_stock: 0,
      comment: '',
    }));

    await supabase.from('rm_daily_snapshots').upsert(inserts, {
      onConflict: 'snapshot_date,raw_material_name',
    });

    setShowNewSnapshot(false);
    fetchData();
  }

  function exportCSV() {
    const header = ['Raw Material,Opening Stock,MTD Receipts,Total Available,Issues to Production,Theo. Closing Stock,Physical Stock,System Stock,Stock Variance,Comment'];
    const body = visibleRows.map(
      (r) =>
        `${r.raw_material_name},${r.opening_stock},${r.mtd_receipts},${r.total_available},${r.issues_to_production},${r.theo_closing_stock},${r.physical_stock},${r.system_stock},${r.stock_variance},"${r.comment || ''}"`
    );
    const blob = new Blob([header.concat(body).join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `RM-Stock-${date}.csv`;
    a.click();
  }

  const toggleSort = (key: 'name' | 'variance' | 'stock') => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const varianceBadge = (v: number) => {
    const abs = Math.abs(v);
    if (abs <= 0.1) return <span className="inline-flex items-center gap-1 text-emerald-600 text-[11px] font-medium">0</span>;
    if (abs <= 1) return <span className="inline-flex items-center gap-1 text-amber-600 text-[11px] font-medium">{fmt(v)}</span>;
    return <span className="inline-flex items-center gap-1 text-red-600 text-[11px] font-medium bg-red-50 px-1.5 py-0.5 rounded">{fmt(v)}</span>;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Raw Materials Stock Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {format(new Date(date + 'T00:00:00'), 'MMMM yyyy')} — BULK RAW MATERIALS
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {varianceCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-red-50 text-red-700 rounded-lg text-xs font-medium border border-red-100">
              <AlertTriangle className="w-3.5 h-3.5" />
              {varianceCount} material{varianceCount > 1 ? 's' : ''} with variance
            </span>
          )}
          <div className="relative">
            <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
            />
          </div>
          <button
            onClick={() => setShowNewSnapshot(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-teal-50 text-teal-700 rounded-lg border border-teal-200 hover:bg-teal-100 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> New Snapshot
          </button>
          <button
            onClick={fetchData}
            className="w-9 h-9 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4 text-gray-500" />
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <button
            onClick={() => setHideZeros(!hideZeros)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
              hideZeros ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {hideZeros ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {hideZeros ? 'Showing active' : 'Hide zeros'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-3 py-3 font-medium whitespace-nowrap cursor-pointer hover:text-gray-700" onClick={() => toggleSort('name')}>
                  <span className="flex items-center gap-1">Raw Material {sortKey === 'name' && (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</span>
                </th>
                <th className="px-3 py-3 font-medium text-right whitespace-nowrap">Opening Stock (kg)</th>
                <th className="px-3 py-3 font-medium text-right whitespace-nowrap">
                  <span className="flex items-center gap-1 justify-end text-emerald-600"><ArrowDownToLine className="w-3 h-3" /> MTD Receipts</span>
                </th>
                <th className="px-3 py-3 font-medium text-right whitespace-nowrap">Total Available</th>
                <th className="px-3 py-3 font-medium text-right whitespace-nowrap">
                  <span className="flex items-center gap-1 justify-end text-amber-600"><ArrowUpFromLine className="w-3 h-3" /> Issues</span>
                </th>
                <th className="px-3 py-3 font-medium text-right whitespace-nowrap">Theo. Closing</th>
                <th className="px-3 py-3 font-medium text-right whitespace-nowrap">Physical Stock</th>
                <th className="px-3 py-3 font-medium text-right whitespace-nowrap">System Stock</th>
                <th className="px-3 py-3 font-medium text-right whitespace-nowrap cursor-pointer hover:text-gray-700" onClick={() => toggleSort('variance')}>
                  <span className="flex items-center gap-1 justify-end">Variance {sortKey === 'variance' && (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</span>
                </th>
                <th className="px-3 py-3 font-medium whitespace-nowrap min-w-[140px]">Comment</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="py-16 text-center text-gray-400">Loading...</td></tr>
              ) : visibleRows.length === 0 ? (
                <tr><td colSpan={10} className="py-16 text-center text-gray-400">No data for selected date</td></tr>
              ) : (
                visibleRows.map((row) => (
                  <tr
                    key={row.raw_material_name}
                    className={`border-b border-gray-100 hover:bg-gray-50/50 transition-colors ${
                      Math.abs(row.stock_variance) > 0.1 ? 'bg-red-50/30' : ''
                    }`}
                  >
                    <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">{row.raw_material_name}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600 tabular-nums whitespace-nowrap">
                      {fmt(row.opening_stock)}
                      {row.opening_stock_base_date && (
                        <span className="block text-[10px] text-gray-400">as at {format(new Date(row.opening_stock_base_date + 'T00:00:00'), 'dd MMM')}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-emerald-600 tabular-nums whitespace-nowrap">{fmt(row.mtd_receipts)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600 tabular-nums whitespace-nowrap">{fmt(row.total_available)}</td>
                    <td className="px-3 py-2.5 text-right text-amber-600 tabular-nums whitespace-nowrap">{fmt(row.issues_to_production)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600 tabular-nums whitespace-nowrap">{fmt(row.theo_closing_stock)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <input
                        type="number"
                        step="0.001"
                        value={row.physical_stock === 0 ? '' : row.physical_stock}
                        onChange={(e) => {
                          const val = e.target.value === '' ? 0 : Number(e.target.value);
                          updatePhysicalStock(row, val);
                        }}
                        className="w-28 px-2 py-1 text-right border border-gray-200 rounded text-[13px] focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 tabular-nums"
                        placeholder="0"
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-400 tabular-nums whitespace-nowrap">
                      {row.system_stock === 0 ? (
                        <span className="text-gray-300 italic text-[11px]">Sage sync pending</span>
                      ) : (
                        fmt(row.system_stock)
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">{varianceBadge(row.stock_variance)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <input
                        type="text"
                        value={row.comment || ''}
                        onChange={(e) => updateComment(row, e.target.value)}
                        className="w-full px-2 py-1 border border-gray-200 rounded text-[12px] focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                        placeholder="Add comment..."
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Snapshot confirmation */}
      {showNewSnapshot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full shadow-lg">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Create New Snapshot</h3>
            <p className="text-sm text-gray-500 mb-4">
              This will copy the previous day's physical stock as the new opening stock for <strong>{date}</strong>.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewSnapshot(false)} className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
              <button onClick={createSnapshot} className="px-4 py-2 text-sm font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
