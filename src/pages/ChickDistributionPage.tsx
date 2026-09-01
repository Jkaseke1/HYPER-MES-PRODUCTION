import { useState, useEffect, useCallback } from 'react';
// Force rebuild - v2.1 - flicker fix + PO comparison
import { Calendar, ChevronLeft, ChevronRight, Download, Plus, Save, Truck, Users } from 'lucide-react';
import { format, addDays, subDays, endOfWeek } from 'date-fns';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';

interface Route { id: string; name: string; sort_order: number; }
interface Customer { id: string; name: string; code: string; route_id?: string; }
interface DistLine {
  id: string;
  customer_id: string;
  route_id: string;
  delivery_date: string;
  planned_qty: number;
  actual_qty: number;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// Color coding per day - distinct light/dark pairs for headers and cells
const DAY_COLORS = [
  { header: 'bg-blue-100 text-blue-900', sub: 'bg-blue-50 text-blue-800', cell: 'bg-blue-50/40' },        // Monday
  { header: 'bg-emerald-100 text-emerald-900', sub: 'bg-emerald-50 text-emerald-800', cell: 'bg-emerald-50/40' },  // Tuesday
  { header: 'bg-amber-100 text-amber-900', sub: 'bg-amber-50 text-amber-800', cell: 'bg-amber-50/40' },    // Wednesday
  { header: 'bg-purple-100 text-purple-900', sub: 'bg-purple-50 text-purple-800', cell: 'bg-purple-50/40' }, // Thursday
  { header: 'bg-pink-100 text-pink-900', sub: 'bg-pink-50 text-pink-800', cell: 'bg-pink-50/40' },        // Friday
];

function getMonday(d: Date) {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

export default function ChickDistributionPage() {
  const [weekStart, setWeekStart] = useState(getMonday(new Date()));
  const [routes, setRoutes] = useState<Route[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [lines, setLines] = useState<DistLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [poTotalBooked, setPoTotalBooked] = useState(0);

  const weekDates = DAYS.map((_, i) => addDays(weekStart, i));
  const weekEnding = endOfWeek(weekStart, { weekStartsOn: 1 });

  // Fetch routes and customers once on mount — never changes
  useEffect(() => {
    (async () => {
      const [rRes, cRes] = await Promise.all([
        supabase.from('chick_routes').select('*').eq('is_active', true).order('sort_order'),
        supabase.from('chick_customers').select('*').eq('is_active', true).order('name'),
      ]);
      setRoutes(rRes.data || []);
      setCustomers(cRes.data || []);
    })();
  }, []);

  // Fetch schedule data when week changes — silently, no flash
  const fetchSchedule = useCallback(async () => {
    const sRes = await supabase
      .from('chick_distribution_schedules')
      .select('*')
      .eq('week_ending', format(weekEnding, 'yyyy-MM-dd'))
      .maybeSingle();

    if (sRes.data) {
      setScheduleId(sRes.data.id);
      const { data: lData } = await supabase
        .from('chick_distribution_lines')
        .select('*')
        .eq('schedule_id', sRes.data.id);
      setLines(lData || []);
    } else {
      setScheduleId(null);
      setLines([]);
    }
  }, [weekEnding]);

  useEffect(() => { fetchSchedule(); }, [fetchSchedule]);

  // Fetch total PO booked qty for comparison (all APPROVED/DISPATCHED POs)
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('chick_purchase_orders')
        .select('id, status, lines:chick_po_lines(booked_qty)')
        .in('status', ['APPROVED', 'DISPATCHED', 'DELIVERED']);
      const total = (data || []).reduce((sum: number, po: any) => {
        const poLines = po.lines || [];
        return sum + poLines.reduce((s: number, l: any) => s + (l.booked_qty || 0), 0);
      }, 0);
      setPoTotalBooked(total);
    })();
  }, []);

  const getQty = (customerId: string, routeId: string, date: Date) => {
    const line = lines.find(l =>
      l.customer_id === customerId &&
      l.route_id === routeId &&
      l.delivery_date === format(date, 'yyyy-MM-dd')
    );
    return line?.planned_qty || 0;
  };

  const setQty = (customerId: string, routeId: string, date: Date, qty: number) => {
    const key = format(date, 'yyyy-MM-dd');
    setLines(prev => {
      const idx = prev.findIndex(l => l.customer_id === customerId && l.route_id === routeId && l.delivery_date === key);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], planned_qty: qty };
        return copy;
      }
      return [...prev, {
        id: '',
        customer_id: customerId,
        route_id: routeId,
        delivery_date: key,
        planned_qty: qty,
        actual_qty: 0,
      }];
    });
  };

  const customerTotal = (customerId: string) => {
    return lines.filter(l => l.customer_id === customerId).reduce((s, l) => s + (l.planned_qty || 0), 0);
  };

  const grandTotal = () => lines.reduce((s, l) => s + (l.planned_qty || 0), 0);

  const customerAvg = (customerId: string) => {
    const total = customerTotal(customerId);
    const daysWithQty = lines.filter(l => l.customer_id === customerId && (l.planned_qty || 0) > 0).length;
    return daysWithQty > 0 ? Math.round(total / daysWithQty) : 0;
  };

  const customerPct = (customerId: string) => {
    const total = grandTotal();
    return total > 0 ? ((customerTotal(customerId) / total) * 100).toFixed(2) : '0.00';
  };

  const createSchedule = async () => {
    setSaving(true);
    const { data, error } = await supabase.from('chick_distribution_schedules').insert({
      week_ending: format(weekEnding, 'yyyy-MM-dd'),
      status: 'draft',
    }).select().single();
    setSaving(false);
    if (error) { alert('Failed to create schedule: ' + error.message); return; }
    setScheduleId(data.id);
  };

  const saveAll = async () => {
    if (!scheduleId) { await createSchedule(); return; }
    setSaving(true);
    const inserts = lines.filter(l => !l.id && (l.planned_qty || 0) > 0).map(l => ({
      schedule_id: scheduleId,
      customer_id: l.customer_id,
      route_id: l.route_id,
      delivery_date: l.delivery_date,
      planned_qty: l.planned_qty,
      actual_qty: l.actual_qty,
    }));
    const updates = lines.filter(l => l.id && (l.planned_qty || 0) >= 0).map(l => ({
      id: l.id,
      planned_qty: l.planned_qty,
    }));

    if (inserts.length > 0) {
      const { data } = await supabase.from('chick_distribution_lines').insert(inserts).select();
      if (data) {
        setLines(prev => prev.map(p => {
          const matched = data.find((d: any) => !p.id && p.customer_id === d.customer_id && p.route_id === d.route_id && p.delivery_date === d.delivery_date);
          return matched ? { ...p, id: matched.id } : p;
        }));
      }
    }
    for (const u of updates) {
      await supabase.from('chick_distribution_lines').update({ planned_qty: u.planned_qty }).eq('id', u.id);
    }
    setSaving(false);
  };

  const exportCSV = () => {
    let csv = 'Customer,' + DAYS.map((d) => routes.map(r => `${d} - ${r.name}`).join(',')).join(',') + ',TOTAL,AVG,%\n';
    for (const c of customers) {
      const row = [c.name];
      for (let i = 0; i < 5; i++) {
        for (const r of routes) {
          row.push(String(getQty(c.id, r.id, weekDates[i])));
        }
      }
      row.push(String(customerTotal(c.id)));
      row.push(String(customerAvg(c.id)));
      row.push(customerPct(c.id));
      csv += row.join(',') + '\n';
    }
    // totals row
    const totals = ['TOTAL'];
    for (let i = 0; i < 5; i++) {
      for (const r of routes) {
        totals.push(String(lines.filter(l => l.delivery_date === format(weekDates[i], 'yyyy-MM-dd') && l.route_id === r.id).reduce((s, l) => s + (l.planned_qty || 0), 0)));
      }
    }
    totals.push(String(grandTotal()));
    totals.push('');
    totals.push('');
    csv += totals.join(',') + '\n';

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Chick_Distribution_${format(weekEnding, 'yyyy-MM-dd')}.csv`;
    a.click();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Chick Distribution Schedule</h1>
          <p className="text-sm text-slate-500 mt-1">Weekly delivery planning by route and customer</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setWeekStart(subDays(weekStart, 7))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-medium text-slate-700">
              {format(weekStart, 'MMM d')} — {format(weekEnding, 'MMM d, yyyy')}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <Users className="w-5 h-5 text-blue-500" />
            <div>
              <p className="text-xs text-slate-500">Customers</p>
              <p className="text-lg font-bold text-slate-800">{customers.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <Truck className="w-5 h-5 text-emerald-500" />
            <div>
              <p className="text-xs text-slate-500">Routes</p>
              <p className="text-lg font-bold text-slate-800">{routes.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <Calendar className="w-5 h-5 text-amber-500" />
            <div>
              <p className="text-xs text-slate-500">Week Total</p>
              <p className="text-lg font-bold text-slate-800">{grandTotal().toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-slate-500 mb-1">PO Booked vs Distribution</p>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-blue-700">{poTotalBooked.toLocaleString()}</span>
              <span className="text-xs text-slate-400">vs</span>
              <span className="text-lg font-bold text-emerald-700">{grandTotal().toLocaleString()}</span>
            </div>
            {poTotalBooked > 0 && (
              <p className={`text-[11px] mt-0.5 ${grandTotal() > poTotalBooked ? 'text-red-500' : grandTotal() < poTotalBooked ? 'text-amber-500' : 'text-emerald-500'}`}>
                {grandTotal() > poTotalBooked ? 'Distribution exceeds PO!' : grandTotal() < poTotalBooked ? `${(poTotalBooked - grandTotal()).toLocaleString()} remaining` : 'Fully allocated'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Actions - sticky bar */}
      <div className="sticky top-0 z-30 -mx-6 px-6 py-3 bg-white border-b border-slate-200 flex items-center justify-between shadow-sm">
        <div className="flex gap-2">
          {!scheduleId && (
            <Button size="sm" onClick={createSchedule} disabled={saving}>
              <Plus className="w-4 h-4 mr-1" />
              {saving ? 'Creating...' : 'Create Schedule'}
            </Button>
          )}
          {scheduleId && (
            <Button size="sm" onClick={saveAll} disabled={saving}>
              <Save className="w-4 h-4 mr-1" />
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={exportCSV}>
          <Download className="w-4 h-4 mr-1" />
          Export CSV
        </Button>
      </div>

      {/* Distribution Grid */}
      <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="text-left px-3 py-2 text-xs font-semibold text-slate-600 border-b border-r border-slate-200 w-40 sticky left-0 bg-slate-50 z-10">Customer</th>
                {DAYS.map((_, i) => (
                  <th key={DAYS[i]} colSpan={routes.length} className={`text-center px-2 py-2 text-xs font-bold border-b border-r border-slate-200 ${DAY_COLORS[i].header}`}>
                    {DAYS[i]} {format(weekDates[i], 'd')}
                  </th>
                ))}
                <th className="text-center px-3 py-2 text-xs font-semibold text-slate-600 border-b border-r border-slate-200 bg-slate-100">TOTAL</th>
                <th className="text-center px-3 py-2 text-xs font-semibold text-slate-600 border-b border-r border-slate-200 bg-slate-100">AVG</th>
                <th className="text-center px-3 py-2 text-xs font-semibold text-slate-600 border-b border-slate-200 bg-slate-100">%</th>
              </tr>
              <tr className="bg-slate-50">
                <th className="border-r border-b border-slate-200 sticky left-0 bg-slate-50 z-10"></th>
                {DAYS.map((day, dayIdx) => (
                  routes.map(r => (
                    <th key={`${day}-${r.id}`} className={`text-center px-1 py-1 text-[10px] font-semibold border-b border-r border-slate-200 uppercase tracking-wide w-20 ${DAY_COLORS[dayIdx].sub}`}>
                      {r.name}
                    </th>
                  ))
                ))}
                <th className="border-r border-b border-slate-200"></th>
                <th className="border-r border-b border-slate-200"></th>
                <th className="border-b border-slate-200"></th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c, idx) => (
                <tr key={c.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                  <td className="px-3 py-1.5 text-sm font-medium text-slate-700 border-r border-b border-slate-200 sticky left-0 bg-inherit z-10">
                    {c.name}
                  </td>
                  {DAYS.map((_, dayIdx) => (
                    routes.map(r => (
                      <td key={`${c.id}-${dayIdx}-${r.id}`} className={`border-r border-b border-slate-200 p-0 ${DAY_COLORS[dayIdx].cell}`}>
                        <input
                          type="number"
                          min={0}
                          value={getQty(c.id, r.id, weekDates[dayIdx]) || ''}
                          onChange={(e) => setQty(c.id, r.id, weekDates[dayIdx], parseInt(e.target.value) || 0)}
                          className="w-full px-1 py-1 text-center text-sm border-0 focus:ring-0 focus:bg-white bg-transparent"
                          placeholder="0"
                        />
                      </td>
                    ))
                  ))}
                  <td className="text-center px-2 py-1.5 text-sm font-bold text-slate-800 border-r border-b border-slate-200 bg-slate-50">
                    {customerTotal(c.id).toLocaleString()}
                  </td>
                  <td className="text-center px-2 py-1.5 text-sm text-slate-600 border-r border-b border-slate-200">
                    {customerAvg(c.id)}
                  </td>
                  <td className="text-center px-2 py-1.5 text-sm text-slate-600 border-b border-slate-200">
                    {customerPct(c.id)}%
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="bg-slate-100 font-semibold">
                <td className="px-3 py-2 text-sm text-slate-800 border-r border-b border-slate-200 sticky left-0 bg-slate-100 z-10">TOTAL</td>
                {DAYS.map((_, dayIdx) => (
                  routes.map(r => (
                    <td key={`total-${dayIdx}-${r.id}`} className={`text-center px-2 py-2 text-sm font-bold border-r border-b border-slate-200 ${DAY_COLORS[dayIdx].sub}`}>
                      {lines.filter(l => l.delivery_date === format(weekDates[dayIdx], 'yyyy-MM-dd') && l.route_id === r.id).reduce((s, l) => s + (l.planned_qty || 0), 0).toLocaleString()}
                    </td>
                  ))
                ))}
                <td className="text-center px-2 py-2 text-sm font-bold text-slate-800 border-r border-b border-slate-200">
                  {grandTotal().toLocaleString()}
                </td>
                <td className="border-r border-b border-slate-200"></td>
                <td className="border-b border-slate-200"></td>
              </tr>
            </tbody>
          </table>
      </div>
    </div>
  );
}
