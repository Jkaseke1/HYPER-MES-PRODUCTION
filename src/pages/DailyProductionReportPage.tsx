import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CalendarDays, Clock3, Download, Factory, PackageCheck, RefreshCw, Wrench } from 'lucide-react';
import { addDays, format } from 'date-fns';
import { supabase } from '../lib/supabase';

type ProductionOrderRow = {
  id: string; batch_number: string; planned_qty: number; actual_qty: number;
  actual_bags?: number | null; unit_size?: string | number | null; shift?: string | null;
  actual_hours?: number | null; labour_force?: number | null; actual_end?: string | null; created_at: string;
  formulations?: { name?: string; code?: string } | null;
  machines?: { name?: string; code?: string } | null;
};
type MaterialRow = { production_order_id: string; planned_qty: number; actual_qty: number; issued: boolean; raw_materials?: { name?: string; code?: string } | null };
type DowntimeRow = { production_order_id: string; downtime_hours: number; category: string; reason: string };

const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const precise = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function kgToBags(kg: number, unitSize?: string | number | null) {
  const size = Number.parseFloat(String(unitSize || '').replace(/[^0-9.]/g, '')) || 50;
  return size > 0 ? kg / size : 0;
}

function operationalWindow(reportDate: string) {
  const start = new Date(`${reportDate}T07:00:00+02:00`);
  const nextDay = format(addDays(new Date(`${reportDate}T12:00:00`), 1), 'yyyy-MM-dd');
  const end = new Date(`${nextDay}T06:59:59.999+02:00`);
  return { start: start.toISOString(), end: end.toISOString() };
}

export default function DailyProductionReportPage() {
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [orders, setOrders] = useState<ProductionOrderRow[]>([]);
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [downtime, setDowntime] = useState<DowntimeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchReport = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const { start, end } = operationalWindow(selectedDate);
    const { data: orderData, error } = await supabase
      .from('production_orders')
      .select('id, batch_number, planned_qty, actual_qty, actual_bags, unit_size, shift, actual_hours, labour_force, actual_end, created_at, formulations(name, code), machines(name, code)')
      .eq('status', 'completed').gte('actual_end', start).lte('actual_end', end).order('actual_end', { ascending: true });

    if (error) {
      console.error('Unable to load daily production report:', error);
      setOrders([]); setMaterials([]); setDowntime([]);
      if (!silent) setLoading(false);
      return;
    }
    const completed = (orderData || []) as ProductionOrderRow[];
    const ids = completed.map((order) => order.id);
    const [materialResult, downtimeResult] = ids.length
      ? await Promise.all([
          supabase.from('production_order_materials').select('production_order_id, planned_qty, actual_qty, issued, raw_materials(name, code)').in('production_order_id', ids),
          supabase.from('production_order_downtime').select('production_order_id, downtime_hours, category, reason').in('production_order_id', ids),
        ])
      : [{ data: [] as MaterialRow[] }, { data: [] as DowntimeRow[] }];
    setOrders(completed);
    setMaterials((materialResult.data || []) as MaterialRow[]);
    setDowntime((downtimeResult.data || []) as DowntimeRow[]);
    setLastRefresh(new Date());
    if (!silent) setLoading(false);
  }, [selectedDate]);

  useEffect(() => { fetchReport(); }, [fetchReport]);
  useEffect(() => {
    const channel = supabase.channel('daily-production-live-report')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_orders' }, () => fetchReport(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_order_materials' }, () => fetchReport(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_order_downtime' }, () => fetchReport(true))
      .subscribe();
    const interval = window.setInterval(() => fetchReport(true), 30000);
    return () => { window.clearInterval(interval); supabase.removeChannel(channel); };
  }, [fetchReport]);

  const productRows = useMemo(() => {
    const rows = new Map<string, { code: string; name: string; batches: number; kg: number; bags: number }>();
    orders.forEach((order) => {
      const code = order.formulations?.code || 'UNMAPPED';
      const row = rows.get(code) || { code, name: order.formulations?.name || 'Unmapped product', batches: 0, kg: 0, bags: 0 };
      const kg = Number(order.actual_qty || 0);
      row.batches += 1; row.kg += kg; row.bags += Number(order.actual_bags ?? kgToBags(kg, order.unit_size));
      rows.set(code, row);
    });
    return Array.from(rows.values()).sort((a, b) => b.kg - a.kg);
  }, [orders]);

  const materialRows = useMemo(() => {
    const rows = new Map<string, { code: string; name: string; standardKg: number; actualKg: number; issuedLines: number }>();
    materials.forEach((material) => {
      const code = material.raw_materials?.code || 'UNMAPPED';
      const row = rows.get(code) || { code, name: material.raw_materials?.name || 'Unmapped material', standardKg: 0, actualKg: 0, issuedLines: 0 };
      const planned = Number(material.planned_qty || 0); const actual = Number(material.actual_qty || 0);
      row.standardKg += planned;
      row.actualKg += actual > 0 ? actual : (material.issued ? planned : 0);
      if (material.issued) row.issuedLines += 1;
      rows.set(code, row);
    });
    return Array.from(rows.values()).sort((a, b) => b.actualKg - a.actualKg);
  }, [materials]);

  const shiftRows = useMemo(() => {
    const downtimeByOrder = new Map<string, number>();
    downtime.forEach((entry) => downtimeByOrder.set(entry.production_order_id, (downtimeByOrder.get(entry.production_order_id) || 0) + Number(entry.downtime_hours || 0)));
    const rows = new Map<string, { plant: string; shift: string; batches: number; kg: number; bags: number; hours: number; labour: number; downtime: number }>();
    orders.forEach((order) => {
      const plant = order.machines?.name || 'Main Plant'; const shift = order.shift || 'Unassigned shift'; const key = `${plant}::${shift}`;
      const row = rows.get(key) || { plant, shift, batches: 0, kg: 0, bags: 0, hours: 0, labour: 0, downtime: 0 };
      const kg = Number(order.actual_qty || 0);
      row.batches += 1; row.kg += kg; row.bags += Number(order.actual_bags ?? kgToBags(kg, order.unit_size));
      row.hours += Number(order.actual_hours || 0); row.labour += Number(order.labour_force || 0); row.downtime += downtimeByOrder.get(order.id) || 0;
      rows.set(key, row);
    });
    return Array.from(rows.values()).sort((a, b) => a.plant.localeCompare(b.plant) || a.shift.localeCompare(b.shift));
  }, [orders, downtime]);

  const totals = useMemo(() => {
    const kg = orders.reduce((total, order) => total + Number(order.actual_qty || 0), 0);
    const bags = orders.reduce((total, order) => total + Number(order.actual_bags ?? kgToBags(Number(order.actual_qty || 0), order.unit_size)), 0);
    return { kg, bags, hours: orders.reduce((total, order) => total + Number(order.actual_hours || 0), 0), downtimeHours: downtime.reduce((total, row) => total + Number(row.downtime_hours || 0), 0), tonnes: kg / 1000 };
  }, [orders, downtime]);

  const exportCsv = () => {
    const products = productRows.map((row) => ['Batched product', row.code, row.name, row.batches, row.bags.toFixed(2), row.kg.toFixed(3), (row.kg / 1000).toFixed(3)]);
    const usage = materialRows.map((row) => ['Material usage', row.code, row.name, row.issuedLines, '', row.actualKg.toFixed(3), (row.actualKg / 1000).toFixed(3)]);
    const csv = [[`Daily Production & Material Usage Report — ${selectedDate}`], ['Section', 'Code', 'Description', 'Batches / issued lines', 'Bags', 'Quantity (kg)', 'Tonnage'], ...products, ...usage]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = `daily-production-material-usage-${selectedDate}.csv`; link.click(); URL.revokeObjectURL(url);
  };

  return <div className="min-h-screen bg-slate-50 p-6"><div className="mx-auto max-w-7xl space-y-5">
    <header className="overflow-hidden rounded-xl bg-slate-950 text-white shadow-lg"><div className="flex flex-col justify-between gap-5 px-6 py-5 md:flex-row md:items-end"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-300">Operations report</p><h1 className="mt-1 text-2xl font-bold">Daily Production Declaration</h1><p className="mt-1 text-sm text-slate-300">Completed MES batches, issued materials and plant performance for the operating day.</p></div><div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm font-medium"><CalendarDays className="h-4 w-4 text-teal-300" /><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="bg-transparent text-white outline-none [color-scheme:dark]" /></label><button onClick={() => fetchReport()} disabled={loading} title="Refresh report" className="inline-flex items-center gap-2 rounded-md bg-teal-500 px-3 py-2 text-sm font-bold text-slate-950 transition hover:bg-teal-400 disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button><button onClick={exportCsv} disabled={loading} className="inline-flex items-center gap-2 rounded-md border border-white/20 px-3 py-2 text-sm font-bold transition hover:bg-white/10 disabled:opacity-60"><Download className="h-4 w-4" /> Export CSV</button></div></div><div className="border-t border-white/10 bg-white/5 px-6 py-2 text-xs text-slate-300">{lastRefresh ? `Live report refreshed ${lastRefresh.toLocaleTimeString()}` : 'Loading live MES production data'} <span className="mx-2 text-teal-300">•</span> Operating day: 07:00–06:00</div></header>
    <section className="grid grid-cols-2 gap-4 lg:grid-cols-5"><Metric icon={Factory} label="Net production" value={`${number.format(totals.tonnes)} t`} accent="teal" /><Metric icon={PackageCheck} label="Bags produced" value={number.format(totals.bags)} accent="blue" /><Metric icon={Activity} label="Batches completed" value={number.format(orders.length)} accent="violet" /><Metric icon={Clock3} label="Actual run hours" value={`${number.format(totals.hours)} h`} accent="amber" /><Metric icon={Wrench} label="Recorded downtime" value={`${number.format(totals.downtimeHours)} h`} accent="red" /></section>
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm"><SectionHeader title="Completed product output" subtitle="Exact output declared against completed production batches." right={`${productRows.length} product${productRows.length === 1 ? '' : 's'}`} /><div className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-3">{productRows.map((row) => <div key={row.code} className="flex items-center justify-between gap-4 px-5 py-4"><div className="min-w-0"><p className="truncate font-semibold text-slate-900">{row.name}</p><p className="mt-0.5 font-mono text-xs text-teal-700">{row.code}</p></div><div className="shrink-0 text-right"><p className="text-lg font-bold text-slate-950">{precise.format(row.kg / 1000)} t</p><p className="text-xs font-medium text-slate-500">{number.format(row.bags)} bags · {row.batches} batches</p></div></div>)}{productRows.length === 0 && <div className="px-5 py-10 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-3">No completed production was recorded in this period.</div>}</div></section>
    <ReportTable title="Material usage" subtitle="Issued material use aggregated from the BOMs of completed batches." right={`${materialRows.length} materials`} scrollable><thead><tr>{['Material', 'Issued lines', 'Standard (kg)', 'Actual use (kg)', 'Tonnes'].map((head) => <HeaderCell key={head}>{head}</HeaderCell>)}</tr></thead><tbody className="divide-y divide-slate-100">{materialRows.map((row) => <tr key={row.code} className="hover:bg-teal-50/40"><td className="px-5 py-3"><p className="font-semibold text-slate-800">{row.name}</p><p className="font-mono text-xs text-teal-700">{row.code}</p></td><Cell>{row.issuedLines}</Cell><Cell>{precise.format(row.standardKg)}</Cell><Cell strong>{precise.format(row.actualKg)}</Cell><Cell>{precise.format(row.actualKg / 1000)}</Cell></tr>)}{materialRows.length === 0 && <EmptyRow colSpan={5} label="No materials were issued to the completed batches in this period." />}</tbody></ReportTable>
    <ReportTable title="Plant and shift performance" subtitle="Replaces the handwritten Main Plant / Dog Food / Red / Block Plant sections when each production order is assigned to its MES line and shift."><thead><tr>{['Plant', 'Shift', 'Batches', 'Output (t)', 'Bags', 'Run hours', 'Avg t/hour', 'Labour', 'Downtime'].map((head) => <HeaderCell key={head}>{head}</HeaderCell>)}</tr></thead><tbody className="divide-y divide-slate-100">{shiftRows.map((row) => { const tonnes = row.kg / 1000; return <tr key={`${row.plant}-${row.shift}`} className="hover:bg-slate-50"><td className="px-4 py-3 font-semibold text-slate-800">{row.plant}</td><td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">{row.shift}</span></td><Cell>{row.batches}</Cell><Cell strong>{precise.format(tonnes)}</Cell><Cell>{number.format(row.bags)}</Cell><Cell>{number.format(row.hours)}</Cell><Cell>{row.hours > 0 ? precise.format(tonnes / row.hours) : '—'}</Cell><Cell>{row.labour || '—'}</Cell><td className="px-4 py-3 text-sm font-semibold text-red-600">{row.downtime > 0 ? `${number.format(row.downtime)} h` : '—'}</td></tr>; })}{shiftRows.length === 0 && <EmptyRow colSpan={9} label="No completed production was recorded in this period." />}</tbody></ReportTable>
    <div className="rounded-xl border border-teal-200 bg-teal-50 px-5 py-4 text-sm text-teal-950"><p className="font-bold">What this replaces</p><p className="mt-1">The manual report’s batched products, material usage, tonnage, bags, production time, labour and downtime now come directly from MES production orders. Enter actual output/bags, line, shift, labour and downtime against each order for the report to be complete.</p></div>
  </div></div>;
}

function Metric({ icon: Icon, label, value, accent }: { icon: typeof Factory; label: string; value: string; accent: 'teal' | 'blue' | 'violet' | 'amber' | 'red' }) {
  const colors = { teal: 'bg-teal-50 text-teal-700', blue: 'bg-blue-50 text-blue-700', violet: 'bg-violet-50 text-violet-700', amber: 'bg-amber-50 text-amber-700', red: 'bg-red-50 text-red-700' };
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-3"><span className={`rounded-lg p-2 ${colors[accent]}`}><Icon className="h-5 w-5" /></span><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-0.5 text-xl font-bold text-slate-900">{value}</p></div></div></div>;
}
function SectionHeader({ title, subtitle, right }: { title: string; subtitle: string; right?: string }) { return <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4"><div><h2 className="text-lg font-bold text-slate-900">{title}</h2><p className="mt-0.5 text-sm text-slate-500">{subtitle}</p></div>{right && <span className="mt-1 shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{right}</span>}</div>; }
function ReportTable({ title, subtitle, right, scrollable = false, children }: { title: string; subtitle: string; right?: string; scrollable?: boolean; children: React.ReactNode }) { return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><SectionHeader title={title} subtitle={subtitle} right={right} /><div className={scrollable ? 'max-h-[430px] overflow-auto' : 'overflow-x-auto'}><table className="min-w-full text-left text-sm">{children}</table></div></section>; }
function HeaderCell({ children }: { children: React.ReactNode }) { return <th className="whitespace-nowrap bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-600">{children}</th>; }
function Cell({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) { return <td className={`whitespace-nowrap px-4 py-3 text-sm ${strong ? 'font-bold text-slate-900' : 'text-slate-700'}`}>{children}</td>; }
function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) { return <tr><td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-slate-500">{label}</td></tr>; }
