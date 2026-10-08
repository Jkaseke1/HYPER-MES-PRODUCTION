import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarDays, ChevronLeft, ChevronRight, Landmark, RefreshCw, Search, TrendingUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

type Sale = { id: string; invoice_date: string; warehouse_code: string; warehouse_name: string; reporting_category: string; category: string; sub_category: string; transaction_type: string; total_tonnes: number; total_sales_amount: number; line_count: number; imported_at: string };
type Period = 'all' | 'day' | 'week' | 'month' | 'year' | 'custom';
type Channel = 'all' | 'Branch POS' | 'HQ Invoiced';
type Summary = { label: string; tonnes: number; value: number; rows: number };

const FETCH_SIZE = 1000;
const DETAIL_SIZE = 30;
const money = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tonnes = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const labels: Record<Period, string> = { all: 'All time', day: 'Day', week: 'Week', month: 'Month', year: 'Year', custom: 'Custom' };

const shiftDate = (value: string, days: number) => { const date = new Date(`${value}T00:00:00`); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); };
const endOfMonth = (month: string) => { const [year, value] = month.split('-').map(Number); return new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10); };
const monthLabel = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

export default function SoldTonnagePage() {
  const [rows, setRows] = useState<Sale[]>([]);
  const [period, setPeriod] = useState<Period>('all');
  const [channel, setChannel] = useState<Channel>('all');
  const [day, setDay] = useState('');
  const [weekEnding, setWeekEnding] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');
  const [detailPage, setDetailPage] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true); const collected: Sale[] = [];
    try {
      for (let from = 0; ; from += FETCH_SIZE) {
        const { data, error } = await supabase.from('sage_sold_tonnage_daily').select('*').order('invoice_date', { ascending: false }).order('id', { ascending: false }).range(from, from + FETCH_SIZE - 1);
        if (error) throw error;
        const page = (data || []) as Sale[]; collected.push(...page);
        if (page.length < FETCH_SIZE) break;
      }
      setRows(collected);
    } catch (error) { toast.error(`Could not load Sage sales reporting: ${error instanceof Error ? error.message : 'Unknown reporting error'}`); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);
  const sourceStart = rows.length ? rows[rows.length - 1].invoice_date : '';
  const sourceEnd = rows[0]?.invoice_date || '';
  useEffect(() => {
    if (!sourceEnd) return;
    setDay((value) => value || sourceEnd); setWeekEnding((value) => value || sourceEnd);
    setMonth((value) => value || sourceEnd.slice(0, 7)); setYear((value) => value || sourceEnd.slice(0, 4));
  }, [sourceEnd]);

  const range = useMemo(() => {
    if (!sourceEnd) return { from: '', to: '' };
    if (period === 'day') return { from: day || sourceEnd, to: day || sourceEnd };
    if (period === 'week') { const ending = weekEnding || sourceEnd; return { from: shiftDate(ending, -6), to: ending }; }
    if (period === 'month') { const selected = month || sourceEnd.slice(0, 7); return { from: `${selected}-01`, to: endOfMonth(selected) }; }
    if (period === 'year') { const selected = year || sourceEnd.slice(0, 4); return { from: `${selected}-01-01`, to: `${selected}-12-31` }; }
    if (period === 'custom') return { from: fromDate, to: toDate };
    return { from: sourceStart, to: sourceEnd };
  }, [day, fromDate, month, period, sourceEnd, sourceStart, toDate, weekEnding, year]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (range.from && row.invoice_date < range.from) return false;
      if (range.to && row.invoice_date > range.to) return false;
      if (channel !== 'all' && row.transaction_type !== channel) return false;
      return !query || [row.warehouse_code, row.warehouse_name, row.reporting_category, row.category, row.sub_category, row.transaction_type].join(' ').toLowerCase().includes(query);
    });
  }, [channel, range, rows, search]);
  useEffect(() => { setDetailPage(0); }, [channel, range.from, range.to, search]);

  const report = useMemo(() => {
    const channels = new Map<string, Summary>(); const categories = new Map<string, Summary>(); const branches = new Map<string, Summary>(); const mix = new Map<string, Map<string, number>>(); const trend = new Map<string, { sort: string; label: string; tonnes: number }>();
    let totalTonnes = 0; let totalValue = 0; let reversals = 0; let latestImport = '';
    const monthly = period === 'all' || period === 'year';
    visible.forEach((row) => {
      const rowTonnes = Number(row.total_tonnes || 0); const rowValue = Number(row.total_sales_amount || 0); const category = row.reporting_category || row.category || 'Unclassified'; const branch = row.warehouse_code || 'HQ';
      totalTonnes += rowTonnes; totalValue += rowValue; if (rowTonnes < 0 || rowValue < 0) reversals += 1; if (row.imported_at > latestImport) latestImport = row.imported_at;
      add(channels, row.transaction_type || 'Other', rowTonnes, rowValue); add(categories, category, rowTonnes, rowValue); add(branches, branch, rowTonnes, rowValue);
      const branchMix = mix.get(category) || new Map<string, number>(); branchMix.set(branch, (branchMix.get(branch) || 0) + rowTonnes); mix.set(category, branchMix);
      const bucket = monthly ? row.invoice_date.slice(0, 7) : row.invoice_date; const point = trend.get(bucket) || { sort: bucket, label: monthly ? monthLabel(bucket) : bucket.slice(5), tonnes: 0 }; point.tonnes += rowTonnes; trend.set(bucket, point);
    });
    const categoryList = [...categories.values()].sort((a, b) => b.tonnes - a.tonnes); const branchList = [...branches.values()].sort((a, b) => b.tonnes - a.tonnes);
    return { totalTonnes, totalValue, reversals, latestImport, channels: [...channels.values()].sort((a, b) => b.tonnes - a.tonnes), categories: categoryList.slice(0, 6), branches: branchList.slice(0, 8), mix, trend: [...trend.values()].sort((a, b) => a.sort.localeCompare(b.sort)) };
  }, [period, visible]);

  const years = [...new Set(rows.map((row) => row.invoice_date.slice(0, 4)))].sort().reverse();
  const categoryCards = report.categories.map((category) => ({ ...category, branches: [...(report.mix.get(category.label) || new Map<string, number>()).entries()].sort(([, a], [, b]) => b - a).slice(0, 3) }));
  const pageCount = Math.max(1, Math.ceil(visible.length / DETAIL_SIZE)); const details = visible.slice(detailPage * DETAIL_SIZE, (detailPage + 1) * DETAIL_SIZE);
  const latestImport = report.latestImport ? new Date(report.latestImport).toLocaleString() : 'Not yet imported';
  const maxBranch = Math.max(...report.branches.map((item) => Math.abs(item.tonnes)), 1);

  return <div className="min-h-[calc(100vh-4rem)] bg-slate-50 p-4 md:p-6"><div className="mx-auto max-w-[1500px] space-y-5">
    <section className="overflow-hidden rounded-lg border border-slate-900 bg-slate-900 text-white shadow-lg"><div className="flex flex-col gap-5 px-6 py-6 xl:flex-row xl:items-end xl:justify-between"><div><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-cyan-300"><Landmark className="h-4 w-4" /> Sage reporting</p><h1 className="mt-2 text-2xl font-bold">Sold Tonnage</h1><p className="mt-1 text-sm text-slate-300">Sales performance from the Power BI reporting view.</p></div><div className="flex flex-col gap-3 xl:items-end"><div className="text-right text-xs text-slate-300"><p className="font-semibold text-white">{range.from && range.to ? `${range.from} to ${range.to}` : 'No imported period'}</p><p>Latest import: {latestImport}</p></div><div className="flex flex-wrap gap-2"><span className="self-center text-xs font-bold uppercase tracking-wide text-slate-400">Channel</span>{(['all', 'Branch POS', 'HQ Invoiced'] as Channel[]).map((item) => <button key={item} type="button" onClick={() => setChannel(item)} className={`rounded-md border px-3 py-1.5 text-xs font-bold transition ${channel === item ? 'border-cyan-300 bg-cyan-300 text-slate-950' : 'border-slate-600 text-slate-100 hover:border-cyan-300'}`}>{item === 'all' ? 'All sales' : item}</button>)}<button type="button" title="Refresh reporting data" onClick={() => void load()} disabled={loading} className="grid h-8 w-8 place-items-center rounded-md border border-slate-600 text-white disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div></div></div><div className="grid border-t border-slate-700 sm:grid-cols-2 lg:grid-cols-4"><HeroMetric label="Net tonnes" value={`${tonnes.format(report.totalTonnes)} t`} /><HeroMetric label="Net sales value" value={money.format(report.totalValue)} /><HeroMetric label="Sales records" value={visible.length.toLocaleString()} /><HeroMetric label="Credit / reversal rows" value={report.reversals.toLocaleString()} /></div></section>

    <section className="border-b border-slate-200 bg-white px-5 py-4 shadow-sm"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Reporting period</p><div className="mt-2 flex flex-wrap gap-2">{(['day', 'week', 'month', 'year', 'all', 'custom'] as Period[]).map((item) => <button key={item} type="button" onClick={() => setPeriod(item)} className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${period === item ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-200 text-slate-600 hover:border-teal-400'}`}>{labels[item]}</button>)}</div></div><PeriodPicker period={period} sourceStart={sourceStart} sourceEnd={sourceEnd} day={day} setDay={setDay} weekEnding={weekEnding} setWeekEnding={setWeekEnding} month={month} setMonth={setMonth} year={year} setYear={setYear} years={years} fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} /></div></section>

    <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]"><section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-900">Sales trend</h2><p className="mt-1 text-xs text-slate-500">{period === 'all' || period === 'year' ? 'Monthly' : 'Daily'} net tonnes for the selected period.</p></div><TrendingUp className="h-5 w-5 text-teal-600" /></div><div className="mt-4 h-64">{report.trend.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={report.trend} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e2e8f0" /><XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} /><YAxis tickLine={false} axisLine={false} fontSize={12} /><Tooltip formatter={(value) => [`${tonnes.format(Number(value || 0))} t`, 'Net tonnes']} cursor={{ fill: '#f1f5f9' }} /><Bar dataKey="tonnes" fill="#0d9488" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <Empty loading={loading} />}</div></section><section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-900">Tonnes by branch</h2><p className="mt-1 text-xs text-slate-500">Leading warehouse codes in the selected view.</p><div className="mt-5 space-y-3">{report.branches.map((item) => <SummaryBar key={item.label} item={item} maximum={maxBranch} />)}{!report.branches.length && <Empty loading={loading} />}</div></section></div>

    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-900">Category performance</h2><p className="mt-1 text-xs text-slate-500">Top categories with their leading branches, replacing the wide matrix.</p></div><CalendarDays className="h-5 w-5 text-slate-400" /></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{categoryCards.map((category) => <article key={category.label} className="border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-bold text-slate-900">{category.label}</p><p className="mt-1 text-xs text-slate-500">{category.rows.toLocaleString()} reporting rows</p></div><p className="font-mono font-bold text-teal-700">{tonnes.format(category.tonnes)} t</p></div><div className="mt-4 space-y-2">{category.branches.map(([branch, value]) => <div key={branch} className="flex items-center justify-between text-xs"><span className="font-semibold text-slate-600">{branch}</span><span className="font-mono text-slate-800">{tonnes.format(value)} t</span></div>)}{!category.branches.length && <p className="text-xs text-slate-400">No branch allocation in this view.</p>}</div></article>)}{!categoryCards.length && <Empty loading={loading} />}</div></section>

    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><div className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between"><div><h2 className="font-bold text-slate-900">Sales data explorer</h2><p className="mt-1 text-sm text-slate-500">{visible.length.toLocaleString()} matching rows. Open detail only when an investigation is needed.</p></div><button type="button" onClick={() => setDetailsOpen((open) => !open)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-teal-600 hover:text-teal-700">{detailsOpen ? 'Hide detail' : 'View detailed rows'}</button></div>{detailsOpen && <><div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-3 md:flex-row md:items-center md:justify-between"><p className="text-xs text-slate-500">Search narrows the entire report view.</p><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Branch, category, or channel" className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm md:w-72" /></div></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Branch / warehouse</th><th className="px-4 py-3">Product group</th><th className="px-4 py-3">Channel</th><th className="px-4 py-3 text-right">Tonnes</th><th className="px-4 py-3 text-right">Sales value</th></tr></thead><tbody className="divide-y divide-slate-100">{details.map((row) => <tr key={row.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-mono text-xs">{row.invoice_date}</td><td className="px-4 py-3"><p className="font-semibold text-slate-900">{row.warehouse_code || 'HQ'}</p><p className="text-xs text-slate-500">{row.warehouse_name}</p></td><td className="px-4 py-3"><p className="font-semibold">{row.reporting_category || row.category}</p><p className="text-xs text-slate-500">{row.sub_category}</p></td><td className="px-4 py-3">{row.transaction_type}</td><td className="px-4 py-3 text-right font-mono font-bold">{tonnes.format(Number(row.total_tonnes))}</td><td className="px-4 py-3 text-right font-mono">{money.format(Number(row.total_sales_amount))}</td></tr>)}{!details.length && <tr><td colSpan={6}><Empty loading={loading} /></td></tr>}</tbody></table></div><div className="flex items-center justify-between border-t border-slate-100 px-5 py-3"><p className="text-xs text-slate-500">{visible.length ? `Showing ${detailPage * DETAIL_SIZE + 1}-${Math.min((detailPage + 1) * DETAIL_SIZE, visible.length)} of ${visible.length.toLocaleString()} rows` : 'No matching rows'}</p><div className="flex items-center gap-2"><button type="button" title="Previous detail page" onClick={() => setDetailPage((page) => Math.max(0, page - 1))} disabled={detailPage === 0} className="grid h-8 w-8 place-items-center border border-slate-200 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><span className="min-w-20 text-center text-xs font-semibold">Page {detailPage + 1} / {pageCount}</span><button type="button" title="Next detail page" onClick={() => setDetailPage((page) => Math.min(pageCount - 1, page + 1))} disabled={detailPage >= pageCount - 1} className="grid h-8 w-8 place-items-center border border-slate-200 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div></>}</section>
  </div></div>;
}

function PeriodPicker(props: { period: Period; sourceStart: string; sourceEnd: string; day: string; setDay: (value: string) => void; weekEnding: string; setWeekEnding: (value: string) => void; month: string; setMonth: (value: string) => void; year: string; setYear: (value: string) => void; years: string[]; fromDate: string; setFromDate: (value: string) => void; toDate: string; setToDate: (value: string) => void }) {
  const common = 'rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800';
  if (props.period === 'day') return <Picker label="Select day"><input type="date" value={props.day} min={props.sourceStart} max={props.sourceEnd} onChange={(event) => props.setDay(event.target.value)} className={common} /></Picker>;
  if (props.period === 'week') return <Picker label="Week ending"><input type="date" value={props.weekEnding} min={props.sourceStart} max={props.sourceEnd} onChange={(event) => props.setWeekEnding(event.target.value)} className={common} /></Picker>;
  if (props.period === 'month') return <Picker label="Select month"><input type="month" value={props.month} min={props.sourceStart.slice(0, 7)} max={props.sourceEnd.slice(0, 7)} onChange={(event) => props.setMonth(event.target.value)} className={common} /></Picker>;
  if (props.period === 'year') return <Picker label="Select year"><select value={props.year} onChange={(event) => props.setYear(event.target.value)} className={common}>{props.years.map((item) => <option key={item}>{item}</option>)}</select></Picker>;
  if (props.period === 'custom') return <div className="flex flex-wrap gap-3"><Picker label="From"><input type="date" value={props.fromDate} min={props.sourceStart} max={props.sourceEnd} onChange={(event) => props.setFromDate(event.target.value)} className={common} /></Picker><Picker label="To"><input type="date" value={props.toDate} min={props.fromDate || props.sourceStart} max={props.sourceEnd} onChange={(event) => props.setToDate(event.target.value)} className={common} /></Picker></div>;
  return <p className="text-xs text-slate-500">Available: {props.sourceStart || '-'} to {props.sourceEnd || '-'}</p>;
}

function Picker({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1 text-xs font-bold uppercase tracking-wide text-slate-500"><span>{label}</span>{children}</label>; }
function add(map: Map<string, Summary>, label: string, rowTonnes: number, rowValue: number) { const item = map.get(label) || { label, tonnes: 0, value: 0, rows: 0 }; item.tonnes += rowTonnes; item.value += rowValue; item.rows += 1; map.set(label, item); }
function HeroMetric({ label, value }: { label: string; value: string }) { return <div className="border-b border-slate-700 px-6 py-4 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-2 text-2xl font-bold text-white">{value}</p></div>; }
function SummaryBar({ item, maximum }: { item: Summary; maximum: number }) { return <div><div className="flex items-baseline justify-between gap-4 text-sm"><span className="font-semibold text-slate-800">{item.label}</span><span className="font-mono text-slate-900">{tonnes.format(item.tonnes)} t</span></div><div className="mt-2 h-2 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, Math.abs(item.tonnes) / maximum * 100))}%` }} /></div><p className="mt-1 text-xs text-slate-500">{money.format(item.value)} | {item.rows.toLocaleString()} rows</p></div>; }
function Empty({ loading }: { loading: boolean }) { return <div className="grid min-h-32 place-items-center text-sm text-slate-400">{loading ? 'Loading Sage reporting data...' : 'No Sage reporting rows match this view.'}</div>; }
