import { useEffect, useMemo, useState } from 'react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { supabase } from '../lib/supabase';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Gauge, Clock, Factory, Calendar, TrendingUp, AlertTriangle } from 'lucide-react';
import StatCard from '../components/ui/StatCard';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';

interface DashboardRow {
  formulation_id: string;
  formulation_name: string;
  sage_code: string;
  plant: string;
  monthly_plan_kg: number;
  actual_kg: number;
  accepted_kg: number;
  rejected_kg: number;
  actual_hours: number;
  downtime_hours: number;
  unplanned_downtime_hours: number;
  nominal_speed: number; // mt/hr
  planned_runtime: number; // hours
  actual_throughput: number; // mt/hr
  efficiency_pct: number; // actual throughput / nominal speed
  good_production_pct: number; // actual / planned runtime utilization
  asset_intensity_pct: number; // actual / (nominal speed * actual_hours) when running
  availability_pct: number;
  quality_pct: number;
  oee_pct: number;
}

interface DowntimeCategory {
  category: string;
  hours: number;
}

const PLANT_LABELS: Record<string, string> = {
  'Main Plant': 'Main Plant',
  'Dog Plant': 'Dog Plant',
  'Samora Mix': 'Samora Mix',
  'Red Plant': 'Red Plant',
};

export default function ProductionEfficiencyDashboardPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [downtimeCategories, setDowntimeCategories] = useState<DowntimeCategory[]>([]);
  const [loading, setLoading] = useState(false);

  const monthStart = startOfMonth(new Date(year, month - 1, 1));
  const monthEnd = endOfMonth(monthStart);

  const fetchData = async () => {
    setLoading(true);
    try {
      const startIso = monthStart.toISOString();
      const endIso = monthEnd.toISOString();

      // Load completed production orders in the month
      const { data: orders, error: ordersError } = await supabase
        .from('production_orders')
        .select('id, planned_qty, actual_qty, rejected_qty, wastage_qty, actual_hours, formulation_id, formulations!inner(id, name, sage_code, nominal_speed), machines!inner(name)')
        .eq('status', 'completed')
        .gte('actual_end', startIso)
        .lte('actual_end', endIso)
        .order('actual_end', { ascending: true });

      if (ordersError) throw ordersError;

      const orderIds = (orders || []).map((o: any) => o.id);

      // Load downtime for those orders
      let downtimeByOrder: Record<string, { total: number; unplanned: number; categories: Record<string, number> }> = {};
      if (orderIds.length > 0) {
        const { data: dt } = await supabase
          .from('production_order_downtime')
          .select('production_order_id, downtime_hours, category')
          .in('production_order_id', orderIds);
        (dt || []).forEach((d: any) => {
          if (!downtimeByOrder[d.production_order_id]) {
            downtimeByOrder[d.production_order_id] = { total: 0, unplanned: 0, categories: {} };
          }
          downtimeByOrder[d.production_order_id].total += Number(d.downtime_hours || 0);
          // Treat all logged downtime as unplanned for reporting; planned downtime could be categorised separately later
          downtimeByOrder[d.production_order_id].unplanned += Number(d.downtime_hours || 0);
          const cat = d.category || 'Other';
          downtimeByOrder[d.production_order_id].categories[cat] = (downtimeByOrder[d.production_order_id].categories[cat] || 0) + Number(d.downtime_hours || 0);
        });
      }

      // Aggregate by formulation
      const map = new Map<string, DashboardRow>();
      const categoryMap: Record<string, number> = {};

      (orders || []).forEach((o: any) => {
        const f = o.formulations as any;
        const m = o.machines as any;
        const key = f.id;
        const dt = downtimeByOrder[o.id] || { total: 0, unplanned: 0, categories: {} };

        Object.entries(dt.categories).forEach(([cat, hrs]) => {
          categoryMap[cat] = (categoryMap[cat] || 0) + Number(hrs);
        });

        const existing = map.get(key) || {
          formulation_id: f.id,
          formulation_name: f.name,
          sage_code: f.sage_code || '',
          plant: m?.name || 'Unknown Plant',
          monthly_plan_kg: 0,
          actual_kg: 0,
          accepted_kg: 0,
          rejected_kg: 0,
          actual_hours: 0,
          downtime_hours: 0,
          unplanned_downtime_hours: 0,
          nominal_speed: Number(f.nominal_speed || 0),
          planned_runtime: 0,
          actual_throughput: 0,
          efficiency_pct: 0,
          good_production_pct: 0,
          asset_intensity_pct: 0,
          availability_pct: 0,
          quality_pct: 0,
          oee_pct: 0,
        };

        existing.monthly_plan_kg += Number(o.planned_qty || 0);
        existing.actual_kg += Number(o.actual_qty || 0);
        existing.rejected_kg += Number(o.rejected_qty || 0) + Number(o.wastage_qty || 0);
        existing.accepted_kg += Math.max(0, Number(o.actual_qty || 0) - Number(o.rejected_qty || 0) - Number(o.wastage_qty || 0));
        existing.actual_hours += Number(o.actual_hours || 0);
        existing.downtime_hours += dt.total;
        existing.unplanned_downtime_hours += dt.unplanned;
        map.set(key, existing);
      });

      const processed = Array.from(map.values()).map((r) => {
        const planT = r.monthly_plan_kg / 1000;
        const actualT = r.actual_kg / 1000;
        r.planned_runtime = r.nominal_speed > 0 ? planT / r.nominal_speed : 0;
        r.actual_throughput = r.actual_hours > 0 ? actualT / r.actual_hours : 0;
        r.efficiency_pct = r.nominal_speed > 0 && r.actual_throughput > 0
          ? (r.actual_throughput / r.nominal_speed) * 100
          : 0;
        r.good_production_pct = r.planned_runtime > 0
          ? (r.actual_hours / r.planned_runtime) * 100
          : 0;
        r.asset_intensity_pct = r.nominal_speed > 0 && r.actual_hours > 0
          ? (actualT / (r.nominal_speed * r.actual_hours)) * 100
          : 0;
        r.availability_pct = r.actual_hours + r.downtime_hours > 0
          ? (r.actual_hours / (r.actual_hours + r.downtime_hours)) * 100
          : 0;
        r.quality_pct = r.actual_kg > 0 ? (r.accepted_kg / r.actual_kg) * 100 : 0;
        r.oee_pct = r.actual_hours > 0 && r.nominal_speed > 0
          ? (r.availability_pct / 100) * (r.asset_intensity_pct / 100) * (r.quality_pct / 100) * 100
          : 0;
        return r;
      }).sort((a, b) => b.actual_kg - a.actual_kg);

      setRows(processed);
      setDowntimeCategories(
        Object.entries(categoryMap)
          .map(([category, hours]) => ({ category, hours: Math.round(hours * 100) / 100 }))
          .sort((a, b) => b.hours - a.hours)
      );
    } catch (err) {
      console.error('Error fetching production efficiency dashboard:', err);
      setRows([]);
      setDowntimeCategories([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [year, month]);

  useRealtimeRefresh('production-efficiency-live', ['production_orders', 'production_order_downtime'], fetchData);

  const totals = useMemo(() => {
    const planT = rows.reduce((s, r) => s + r.monthly_plan_kg / 1000, 0);
    const actualT = rows.reduce((s, r) => s + r.actual_kg / 1000, 0);
    const hours = rows.reduce((s, r) => s + r.actual_hours, 0);
    const downtime = rows.reduce((s, r) => s + r.downtime_hours, 0);
    const avgEff = rows.length > 0
      ? rows.reduce((s, r) => s + r.efficiency_pct, 0) / rows.length
      : 0;
    const availability = hours + downtime > 0 ? (hours / (hours + downtime)) * 100 : 0;
    const acceptedKg = rows.reduce((s, r) => s + r.accepted_kg, 0);
    const quality = actualT > 0 ? (acceptedKg / 1000 / actualT) * 100 : 0;
    const performance = hours > 0 ? rows.reduce((s, r) => s + r.asset_intensity_pct * r.actual_hours, 0) / hours : 0;
    const oee = availability && performance && quality ? (availability / 100) * (performance / 100) * (quality / 100) * 100 : 0;
    return { planT, actualT, hours, downtime, avgEff, availability, quality, oee };
  }, [rows]);

  const months = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: format(new Date(2024, i, 1), 'MMMM') }));
  const years = Array.from({ length: 5 }, (_, i) => today.getFullYear() - 2 + i);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Production OEE Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Availability, performance and quality from completed production orders and logged downtime.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2">
            <Calendar className="w-4 h-4 text-slate-400" />
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="text-sm border-none focus:ring-0 p-0 bg-transparent"
            >
              {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="text-sm border-none focus:ring-0 p-0 bg-transparent"
            >
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard icon={Factory} title="Planned Tonnage" value={`${totals.planT.toFixed(2)} t`} color="blue" />
        <StatCard icon={TrendingUp} title="Actual Tonnage" value={`${totals.actualT.toFixed(2)} t`} color="teal" />
        <StatCard icon={Clock} title="Production Hours" value={`${totals.hours.toFixed(1)} hrs`} color="emerald" />
        <StatCard icon={AlertTriangle} title="Downtime" value={`${totals.downtime.toFixed(1)} hrs`} color="amber" />
        <StatCard icon={Gauge} title="OEE" value={`${totals.oee.toFixed(1)}%`} color="emerald" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Availability</p><p className="mt-1 text-2xl font-bold text-slate-800">{totals.availability.toFixed(1)}%</p><p className="mt-1 text-xs text-slate-500">Operating hours ÷ operating + logged downtime</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Performance</p><p className="mt-1 text-2xl font-bold text-slate-800">{totals.avgEff.toFixed(1)}%</p><p className="mt-1 text-xs text-slate-500">Actual speed compared with nominal speed</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quality</p><p className="mt-1 text-2xl font-bold text-slate-800">{totals.quality.toFixed(1)}%</p><p className="mt-1 text-xs text-slate-500">Accepted output ÷ recorded output</p></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Downtime by category */}
        <div className="xl:col-span-1 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide">Unplanned Downtime by Category</h3>
          </div>
          {downtimeCategories.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No downtime recorded this month.</p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={downtimeCategories} layout="vertical" margin={{ left: 20, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="category" type="category" stroke="#64748b" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px' }}
                    formatter={(value: number) => [`${value.toFixed(2)} hrs`, 'Hours']}
                  />
                  <Bar dataKey="hours" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* OEE table */}
        <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gauge className="w-5 h-5 text-purple-500" />
              <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide">OEE by Product</h3>
            </div>
            <span className="text-xs text-slate-400">{rows.length} products</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  {['Product', 'Plant', 'Actual (t)', 'Availability', 'Performance', 'Quality', 'OEE', 'Downtime (hrs)'].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 font-semibold text-xs whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-12 text-slate-400 text-sm">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-12 text-slate-400 text-sm">No completed production orders for the selected month.</td></tr>
                ) : rows.map((r) => (
                  <tr key={r.formulation_id} className="hover:bg-slate-50/50">
                    <td className="px-3 py-2 text-slate-800 font-medium">
                      {r.sage_code ? `${r.sage_code} — ` : ''}{r.formulation_name}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{PLANT_LABELS[r.plant] || r.plant}</td>
                    <td className="px-3 py-2 text-slate-800 font-medium tabular-nums">{(r.actual_kg / 1000).toFixed(2)}</td>
                    <td className="px-3 py-2 text-slate-600 tabular-nums">{r.availability_pct.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-slate-600 tabular-nums">{r.asset_intensity_pct.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-slate-600 tabular-nums">{r.quality_pct.toFixed(1)}%</td>
                    <td className="px-3 py-2"><span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${r.oee_pct >= 75 ? 'bg-emerald-100 text-emerald-700' : r.oee_pct >= 55 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{r.oee_pct.toFixed(1)}%</span></td>
                    <td className="px-3 py-2 text-slate-600 tabular-nums">{r.downtime_hours.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
