import { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { Factory, Package, Gauge, Clock, Copy, CheckCircle2 } from 'lucide-react';
import StatCard from '../components/ui/StatCard';

interface OrderRow {
  id: string;
  batch_number: string;
  planned_qty: number;
  actual_qty: number;
  unit_size: string | null;
  shift: string | null;
  operators: string | null;
  labour_force: number | null;
  actual_hours: number | null;
  average_throughput: number | null;
  week_number: number | null;
  planned_end: string | null;
  actual_end: string | null;
  formulations?: { name: string; sage_code: string } | null;
  machines?: { name: string } | null;
  downtime_hours: number;
  downtime_reasons: string[];
}

const PLANTS = ['Main Plant', 'Dog Plant', 'Samora Mix', 'Red Plant'];

export default function ShiftReportsPage() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [date, setDate] = useState(today);
  const [shift, setShift] = useState<'All' | 'Day Shift' | 'Night Shift'>('All');
  const [plant, setPlant] = useState<string>('All');
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      let q = supabase
        .from('production_orders')
        .select('id, batch_number, planned_qty, actual_qty, unit_size, shift, operators, labour_force, actual_hours, average_throughput, week_number, planned_end, actual_end, formulations(name, sage_code), machines(name)')
        .eq('status', 'completed');

      if (date) {
        q = q.gte('planned_end', `${date}T00:00:00`).lte('planned_end', `${date}T23:59:59`);
      }
      if (shift !== 'All') q = q.eq('shift', shift);

      const { data, error } = await q.order('planned_end', { ascending: true });
      if (error) {
        console.error('Failed to load shift report:', error);
        setRows([]);
        setLoading(false);
        return;
      }

      const orders = (data || []) as any[];
      const filtered = plant === 'All' ? orders : orders.filter((o) => o.machines?.name === plant);

      const ids = filtered.map((o) => o.id);
      let downtimeByOrder: Record<string, { total: number; reasons: string[] }> = {};
      if (ids.length > 0) {
        const { data: dt } = await supabase
          .from('production_order_downtime')
          .select('production_order_id, downtime_hours, reason')
          .in('production_order_id', ids);
        (dt || []).forEach((d: any) => {
          if (!downtimeByOrder[d.production_order_id]) downtimeByOrder[d.production_order_id] = { total: 0, reasons: [] };
          downtimeByOrder[d.production_order_id].total += Number(d.downtime_hours || 0);
          downtimeByOrder[d.production_order_id].reasons.push(d.reason);
        });
      }

      const enriched: OrderRow[] = filtered.map((o) => ({
        ...o,
        downtime_hours: downtimeByOrder[o.id]?.total || 0,
        downtime_reasons: downtimeByOrder[o.id]?.reasons || [],
      }));

      setRows(enriched);
      setLoading(false);
    };
    fetchData();
  }, [date, shift, plant]);

  const totals = useMemo(() => {
    const tonnageKg = rows.reduce((s, r) => s + (r.actual_qty || 0), 0);
    const orderCount = rows.length;
    const totalHours = rows.reduce((s, r) => s + Number(r.actual_hours || 0), 0);
    const totalDowntime = rows.reduce((s, r) => s + r.downtime_hours, 0);
    const avgThroughput = totalHours > 0 ? tonnageKg / 1000 / totalHours : 0;
    return { tonnageKg, orderCount, totalHours, totalDowntime, avgThroughput };
  }, [rows]);

  const bagSizeFrom = (r: OrderRow) => {
    const u = r.unit_size;
    if (!u) return 0;
    const n = parseInt(u);
    return isNaN(n) ? 0 : n;
  };

  const exportWhatsApp = async () => {
    if (rows.length === 0) {
      alert('No completed production orders match the current filters.');
      return;
    }
    const d = new Date(date);
    const dateStr = format(d, 'dd/MM/yy');
    const shiftLabel = shift === 'All' ? (rows[0]?.shift || 'Day Shift') : shift;
    const weekNo = rows[0]?.week_number || Math.ceil(((+d - +new Date(d.getFullYear(), 0, 1)) / 86400000 + 1) / 7);

    // Group rows by plant
    const byPlant: Record<string, OrderRow[]> = {};
    rows.forEach((r) => {
      const p = r.machines?.name || 'Unknown Plant';
      if (!byPlant[p]) byPlant[p] = [];
      byPlant[p].push(r);
    });

    let msg = `Good morning\n${shiftLabel} — ${dateStr} WK${weekNo}\n`;

    Object.entries(byPlant).forEach(([plantName, plantRows]) => {
      const operators = Array.from(new Set(plantRows.map((r) => r.operators).filter(Boolean))).join(', ') || '—';
      msg += `\n${plantName.toUpperCase()}\nOperators: ${operators}\n`;

      plantRows.forEach((r) => {
        const bagSize = bagSizeFrom(r);
        const bags = bagSize > 0 ? Math.round(r.actual_qty / bagSize) : 0;
        const tonnage = (r.actual_qty / 1000).toFixed(2);
        const hrs = Number(r.actual_hours || 0).toFixed(1);
        const tp = Number(r.average_throughput || 0).toFixed(2);
        const code = r.formulations?.sage_code || r.batch_number;
        msg += `\n${code} ${bags}x${bagSize}kg\n`;
        msg += `- Total tonnage: ${tonnage}t\n`;
        msg += `- Actual production: ${hrs}hrs\n`;
        msg += `- Average: ${tp}mt/hr\n`;
      });
    });

    const labourForce = rows.reduce((s, r) => s + Number(r.labour_force || 0), 0) || '—';
    const allReasons = rows.flatMap((r) => r.downtime_reasons);
    const reasonsList = allReasons.length > 0
      ? allReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')
      : 'None';

    msg += `\nShift total: ${(totals.tonnageKg / 1000).toFixed(2)}t\n`;
    msg += `- Actual production: ${totals.totalHours.toFixed(1)}hrs\n`;
    msg += `- Average shift throughput: ${totals.avgThroughput.toFixed(2)}mt/hr\n`;
    msg += `- Labour force: ${labourForce}\n`;
    msg += `- Downtime: ${totals.totalDowntime.toFixed(2)}hrs\n`;
    msg += `- Reasons:\n${reasonsList}`;

    try {
      await navigator.clipboard.writeText(msg);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      alert('Failed to copy to clipboard. Here is the report:\n\n' + msg);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Shift Reports</h1>
          <p className="text-sm text-slate-500 mt-1">Production shift summary built from completed production orders.</p>
        </div>
        <button
          onClick={exportWhatsApp}
          className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {copied ? <><CheckCircle2 className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Export Shift Report</>}
        </button>
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/25 focus:border-teal-400"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Shift</label>
          <select
            value={shift}
            onChange={(e) => setShift(e.target.value as any)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/25 focus:border-teal-400"
          >
            <option value="All">All</option>
            <option value="Day Shift">Day Shift</option>
            <option value="Night Shift">Night Shift</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Plant</label>
          <select
            value={plant}
            onChange={(e) => setPlant(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/25 focus:border-teal-400"
          >
            <option value="All">All</option>
            {PLANTS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          icon={Package}
          title="Total Tonnage Produced"
          value={`${totals.tonnageKg.toLocaleString()} kg`}
          color="teal"
        />
        <StatCard
          icon={Factory}
          title="Orders Completed"
          value={totals.orderCount.toString()}
          color="blue"
        />
        <StatCard
          icon={Gauge}
          title="Avg Throughput"
          value={`${totals.avgThroughput.toFixed(2)} mt/hr`}
          color="emerald"
        />
        <StatCard
          icon={Clock}
          title="Total Downtime"
          value={`${totals.totalDowntime.toFixed(2)} hrs`}
          color="amber"
        />
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Plant', 'Product', 'Batch', 'Bags', 'Tonnage (kg)', 'Hours', 'Throughput (mt/hr)', 'Downtime (hrs)', 'Operators'].map((h) => (
                  <th key={h} className="text-left px-3 py-2.5 font-semibold text-slate-600 text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-400 text-sm">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-400 text-sm">No completed production orders match the selected filters.</td></tr>
              ) : rows.map((r) => {
                const bagSize = bagSizeFrom(r);
                const bags = bagSize > 0 ? Math.round(r.actual_qty / bagSize) : 0;
                return (
                  <tr key={r.id} className="hover:bg-slate-50/50">
                    <td className="px-3 py-2 text-slate-700">{r.machines?.name || '—'}</td>
                    <td className="px-3 py-2 text-slate-800 font-medium">{r.formulations?.sage_code ? `${r.formulations.sage_code} — ${r.formulations.name}` : r.formulations?.name || '—'}</td>
                    <td className="px-3 py-2 text-slate-600 font-mono text-xs">{r.batch_number}</td>
                    <td className="px-3 py-2 text-slate-700">{bags}x{bagSize}kg</td>
                    <td className="px-3 py-2 text-slate-800 font-medium">{r.actual_qty.toLocaleString()}</td>
                    <td className="px-3 py-2 text-slate-600">{Number(r.actual_hours || 0).toFixed(1)}</td>
                    <td className="px-3 py-2 text-slate-600">{Number(r.average_throughput || 0).toFixed(2)}</td>
                    <td className="px-3 py-2 text-slate-600">{r.downtime_hours.toFixed(2)}</td>
                    <td className="px-3 py-2 text-slate-600 text-xs">{r.operators || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
