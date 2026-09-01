import { useState, useEffect } from 'react';
import { TrendingDown, TrendingUp, AlertTriangle, BarChart3, Filter } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { supabase } from '../lib/supabase';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import StatCard from '../components/ui/StatCard';

interface BatchYield {
  id: string;
  batch_number: string;
  formulation_name: string;
  machine_name: string;
  planned_qty: number;
  actual_qty: number;
  rejected_qty: number;
  wastage_qty: number;
  yield_percentage: number;
  process_loss_percentage: number;
  process_loss_qty: number;
  actual_hours: number | null;
  cost_per_unit: number;
  status: string;
  actual_end: string | null;
}

export default function ProcessLossReportPage() {
  const [batches, setBatches] = useState<BatchYield[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState(subDays(new Date(), 30).toISOString().split('T')[0]);
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterFormulation, setFilterFormulation] = useState('');
  const [formulations, setFormulations] = useState<{ id: string; name: string }[]>([]);

  async function fetchData() {
    setLoading(true);
    let q = supabase
      .from('production_orders')
      .select('id, batch_number, planned_qty, actual_qty, rejected_qty, wastage_qty, yield_percentage, process_loss_percentage, process_loss_qty, actual_hours, cost_per_unit, status, actual_end, formulations(name), machines(name)')
      .eq('status', 'completed')
      .gte('actual_end', fromDate)
      .lte('actual_end', toDate + 'T23:59:59')
      .order('actual_end', { ascending: false });

    if (filterFormulation) {
      q = q.eq('formulation_id', filterFormulation);
    }

    const { data, error } = await q;
    if (error) {
      console.error('Error fetching batch yields:', error);
      setBatches([]);
    } else {
      const mapped = (data || []).map((d: any) => ({
        id: d.id,
        batch_number: d.batch_number,
        formulation_name: d.formulations?.name || '-',
        machine_name: d.machines?.name || '-',
        planned_qty: d.planned_qty || 0,
        actual_qty: d.actual_qty || 0,
        rejected_qty: d.rejected_qty || 0,
        wastage_qty: d.wastage_qty || 0,
        yield_percentage: d.yield_percentage || 0,
        process_loss_percentage: d.process_loss_percentage || 0,
        process_loss_qty: d.process_loss_qty || 0,
        actual_hours: d.actual_hours,
        cost_per_unit: d.cost_per_unit || 0,
        status: d.status,
        actual_end: d.actual_end,
      }));
      setBatches(mapped);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchData();
    supabase.from('formulations').select('id, name').eq('status', 'active').then(({ data }) => {
      setFormulations(data || []);
    });
  }, []);

  const stats = {
    totalBatches: batches.length,
    avgYield: batches.length > 0 ? Math.round(batches.reduce((s, b) => s + b.yield_percentage, 0) / batches.length * 10) / 10 : 0,
    totalLossKg: Math.round(batches.reduce((s, b) => s + b.process_loss_qty, 0)),
    avgLossPct: batches.length > 0 ? Math.round(batches.reduce((s, b) => s + b.process_loss_percentage, 0) / batches.length * 10) / 10 : 0,
    totalRejected: Math.round(batches.reduce((s, b) => s + b.rejected_qty, 0)),
    totalWastage: Math.round(batches.reduce((s, b) => s + b.wastage_qty, 0)),
  };

  const getYieldColor = (pct: number) => {
    if (pct >= 98) return 'text-emerald-600';
    if (pct >= 95) return 'text-amber-600';
    return 'text-red-600';
  };

  const getYieldBadge = (pct: number) => {
    if (pct >= 98) return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Excellent</Badge>;
    if (pct >= 95) return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Good</Badge>;
    return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Poor</Badge>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Process Loss & Yield Report</h1>
        <p className="text-sm text-slate-500 mt-1">Track yield percentage, process loss, and rejection rates by batch</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon={TrendingUp} title="Avg Yield %" value={`${stats.avgYield}%`} subtitle={`Across ${stats.totalBatches} batches`} color="emerald" />
        <StatCard icon={TrendingDown} title="Total Process Loss" value={`${stats.totalLossKg.toLocaleString()} kg`} subtitle={`${stats.avgLossPct}% average`} color="amber" />
        <StatCard icon={AlertTriangle} title="Rejects + Wastage" value={`${stats.totalRejected.toLocaleString()} + ${stats.totalWastage.toLocaleString()} kg`} subtitle="Quality & handling loss" color="red" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 bg-white p-4 border border-slate-200 rounded-lg">
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">From</label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">To</label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Formulation</label>
          <select
            value={filterFormulation}
            onChange={(e) => setFilterFormulation(e.target.value)}
            className="w-48 px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20"
          >
            <option value="">All formulations</option>
            {formulations.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={fetchData}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold transition-colors inline-flex items-center gap-2"
        >
          <Filter className="w-4 h-4" />
          Apply
        </button>
      </div>

      {/* Table */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="text-xs font-semibold">Batch</TableHead>
              <TableHead className="text-xs font-semibold">Formulation</TableHead>
              <TableHead className="text-xs font-semibold">Line</TableHead>
              <TableHead className="text-xs font-semibold text-right">Planned</TableHead>
              <TableHead className="text-xs font-semibold text-right">Actual</TableHead>
              <TableHead className="text-xs font-semibold text-right">Yield %</TableHead>
              <TableHead className="text-xs font-semibold text-right">Loss kg</TableHead>
              <TableHead className="text-xs font-semibold text-right">Rejected</TableHead>
              <TableHead className="text-xs font-semibold text-right">Wastage</TableHead>
              <TableHead className="text-xs font-semibold text-right">Cost/Unit</TableHead>
              <TableHead className="text-xs font-semibold">Completed</TableHead>
              <TableHead className="text-xs font-semibold">Rating</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={12} className="text-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-slate-600 mx-auto" />
                </TableCell>
              </TableRow>
            )}
            {!loading && batches.map((b) => (
              <TableRow key={b.id} className="hover:bg-slate-50">
                <TableCell className="text-sm font-medium">{b.batch_number}</TableCell>
                <TableCell className="text-sm">{b.formulation_name}</TableCell>
                <TableCell className="text-sm">{b.machine_name}</TableCell>
                <TableCell className="text-sm text-right">{b.planned_qty.toLocaleString()}</TableCell>
                <TableCell className="text-sm text-right font-medium">{b.actual_qty.toLocaleString()}</TableCell>
                <TableCell className={`text-sm text-right font-bold ${getYieldColor(b.yield_percentage)}`}>
                  {b.yield_percentage.toFixed(1)}%
                </TableCell>
                <TableCell className="text-sm text-right text-amber-600">{b.process_loss_qty.toLocaleString()}</TableCell>
                <TableCell className="text-sm text-right text-red-600">{b.rejected_qty.toLocaleString()}</TableCell>
                <TableCell className="text-sm text-right text-orange-600">{b.wastage_qty.toLocaleString()}</TableCell>
                <TableCell className="text-sm text-right">${b.cost_per_unit.toFixed(2)}</TableCell>
                <TableCell className="text-xs text-slate-500">{b.actual_end ? format(new Date(b.actual_end), 'PP') : '-'}</TableCell>
                <TableCell>{getYieldBadge(b.yield_percentage)}</TableCell>
              </TableRow>
            ))}
            {!loading && batches.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="text-center py-8 text-slate-400">
                  <BarChart3 className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  <p>No completed batches found for the selected period</p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
