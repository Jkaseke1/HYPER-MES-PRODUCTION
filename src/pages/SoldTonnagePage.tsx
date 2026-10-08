import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronLeft, ChevronRight, Landmark, RefreshCw, Search, TrendingUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

type Sale = { id: string; invoice_date: string; warehouse_code: string; warehouse_name: string; reporting_category: string; category: string; sub_category: string; transaction_type: string; total_tonnes: number; total_sales_amount: number; line_count: number; imported_at: string };
type Period = 'all' | 'day' | 'week' | 'month' | 'year' | 'custom';
type Channel = 'all' | 'Branch POS' | 'HQ Invoiced';
type Summary = { label: string; tonnes: number; value: number; rows: number };

const FETCH_SIZE = 1000;
const DETAIL_SIZE = 30;
const SALE_COLUMNS = 'id,invoice_date,warehouse_code,warehouse_name,reporting_category,category,sub_category,transaction_type,total_tonnes,total_sales_amount,line_count,imported_at';
let cachedSales: { userId: string; rows: Sale[] } | undefined;
// Keep financial data in memory only, and discard it when the authenticated user changes.
supabase.auth.onAuthStateChange((_event, session) => {
  if (cachedSales?.userId !== session?.user.id) cachedSales = undefined;
});
const money = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tonnes = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const labels: Record<Period, string> = { all: 'All time', day: 'Day', week: 'Week', month: 'Month', year: 'Year', custom: 'Custom' };

const shiftDate = (value: string, days: number) => { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
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
  const [loadError, setLoadError] = useState(false);
  const [explorerMode, setExplorerMode] = useState<'branches' | 'categories'>('branches');

  const load = async () => {
    setLoading(true); setLoadError(false);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) throw new Error('Please sign in to view sales reporting.');
      if (cachedSales?.userId === userId) setRows(cachedSales.rows);
      const query = (from: number, count = false) => supabase.from('sage_sold_tonnage_daily')
        .select(SALE_COLUMNS, count ? { count: 'exact' } : {})
        .order('invoice_date', { ascending: false }).order('id', { ascending: false })
        .range(from, from + FETCH_SIZE - 1);
      const first = await query(0, true);
      if (first.error) throw first.error;
      if (first.count === null) throw new Error('Reporting row count could not be verified.');
      const collected = (first.data || []) as Sale[];
      // Bound concurrency; never publish incomplete pages as complete executive totals.
      for (let offset = FETCH_SIZE; offset < first.count; offset += FETCH_SIZE * 4) {
        const starts = Array.from({ length: Math.min(4, Math.ceil((first.count - offset) / FETCH_SIZE)) }, (_, index) => offset + index * FETCH_SIZE);
        const pages = await Promise.all(starts.map((start) => query(start)));
        for (const page of pages) {
          if (page.error) throw page.error;
          collected.push(...((page.data || []) as Sale[]));
        }
      }
      if (collected.length !== first.count || new Set(collected.map((row) => row.id)).size !== first.count) {
        throw new Error('Sales changed during loading. Please refresh to get complete totals.');
      }
      const { data: currentSession } = await supabase.auth.getSession();
      if (currentSession.session?.user.id !== userId) return;
      cachedSales = { userId, rows: collected };
      setRows(collected);
    } catch (error) { setLoadError(true); toast.error(`Could not load Sage sales reporting: ${error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Unknown reporting error'}`); } finally { setLoading(false); }
  };

  useEffect(() => {
    void load();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') setRows([]);
    });
    return () => data.subscription.unsubscribe();
  }, []);
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
    return { totalTonnes, totalValue, reversals, latestImport, channels: [...channels.values()].sort((a, b) => b.tonnes - a.tonnes), categories: categoryList, branches: branchList, mix, trend: [...trend.values()].sort((a, b) => a.sort.localeCompare(b.sort)) };
  }, [period, visible]);

  const years = [...new Set(rows.map((row) => row.invoice_date.slice(0, 4)))].sort().reverse();
  const categoryCards = report.categories.slice(0, 8).map((category) => ({ ...category, branches: [...(report.mix.get(category.label) || new Map<string, number>()).entries()].sort(([, a], [, b]) => b - a).slice(0, 3) }));
  const pageCount = Math.max(1, Math.ceil(visible.length / DETAIL_SIZE)); const details = visible.slice(detailPage * DETAIL_SIZE, (detailPage + 1) * DETAIL_SIZE);
  const latestImport = report.latestImport ? new Date(report.latestImport).toLocaleString() : 'Not yet imported';
  const maxBranch = Math.max(...report.branches.map((item) => Math.abs(item.tonnes)), 1);
  const peak = report.trend.reduce<(typeof report.trend)[number] | undefined>((best, point) => !best || point.tonnes > best.tonnes ? point : best, undefined);
  const coveredStart = range.from && range.from > sourceStart ? range.from : sourceStart;
  const coveredEnd = range.to && range.to < sourceEnd ? range.to : sourceEnd;
  const coveredDays = coveredStart && coveredEnd ? Math.max(0, Math.round((Date.parse(coveredEnd) - Date.parse(coveredStart)) / 86400000) + 1) : 0;
  const leadingShare = report.totalTonnes > 0 && report.categories[0]?.tonnes >= 0 ? report.categories[0].tonnes / report.totalTonnes * 100 : null;
  const explorerSummary = explorerMode === 'branches' ? report.branches : report.categories;

  return <div className="min-h-[calc(100vh-4rem)] bg-slate-50 p-4 md:p-6"><div className="mx-auto max-w-[1500px] space-y-5">
    <section className="overflow-hidden rounded-lg border border-slate-900 bg-slate-900 text-white shadow-lg"><div className="flex flex-col gap-5 px-6 py-6 xl:flex-row xl:items-end xl:justify-between"><div><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-cyan-300"><Landmark className="h-4 w-4" /> Sage reporting</p><h1 className="mt-2 text-2xl font-bold">Sold Tonnage</h1><p className="mt-1 text-sm text-slate-300">Sales performance from the Power BI reporting view.</p></div><div className="flex flex-col gap-3 xl:items-end"><div className="text-right text-xs text-slate-300"><p className="font-semibold text-white">{range.from && range.to ? `${range.from} to ${range.to}` : 'No imported period'}</p><p>Latest import: {latestImport}{loading && rows.length > 0 ? ' | Refreshing...' : ''}</p></div><div className="flex flex-wrap gap-2"><span className="self-center text-xs font-bold uppercase tracking-wide text-slate-400">Channel</span>{(['all', 'Branch POS', 'HQ Invoiced'] as Channel[]).map((item) => <button key={item} type="button" onClick={() => setChannel(item)} className={`rounded-md border px-3 py-1.5 text-xs font-bold transition ${channel === item ? 'border-cyan-300 bg-cyan-300 text-slate-950' : 'border-slate-600 text-slate-100 hover:border-cyan-300'}`}>{item === 'all' ? 'All sales' : item}</button>)}<button type="button" title="Refresh reporting data" onClick={() => void load()} disabled={loading} className="grid h-8 w-8 place-items-center rounded-md border border-slate-600 text-white disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div></div></div><div className="grid border-t border-slate-700 sm:grid-cols-2 lg:grid-cols-4"><HeroMetric label="Net tonnes" value={rows.length ? `${tonnes.format(report.totalTonnes)} t` : loading || loadError ? '-' : '0 t'} /><HeroMetric label="Net sales value" value={rows.length ? money.format(report.totalValue) : loading || loadError ? '-' : '0.00'} /><HeroMetric label="Sales records" value={rows.length ? visible.length.toLocaleString() : loading || loadError ? '-' : '0'} /><HeroMetric label="Credit / reversal rows" value={rows.length ? report.reversals.toLocaleString() : loading || loadError ? '-' : '0'} /></div></section>
    {loadError && <p role="alert" className="border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900">{rows.length ? 'Refresh failed. Showing the last complete dataset; totals may be out of date.' : 'Sales reporting could not be loaded. Use refresh to try again.'}</p>}

    <section className="border-b border-slate-200 bg-white px-5 py-4 shadow-sm"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Reporting period</p><div className="mt-2 flex flex-wrap gap-2">{(['day', 'week', 'month', 'year', 'all', 'custom'] as Period[]).map((item) => <button key={item} type="button" onClick={() => setPeriod(item)} className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${period === item ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-200 text-slate-600 hover:border-teal-400'}`}>{labels[item]}</button>)}</div></div><PeriodPicker period={period} sourceStart={sourceStart} sourceEnd={sourceEnd} day={day} setDay={setDay} weekEnding={weekEnding} setWeekEnding={setWeekEnding} month={month} setMonth={setMonth} year={year} setYear={setYear} years={years} fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} /></div></section>

    <div className="grid items-start gap-5 xl:grid-cols-[1.55fr_1fr]">
      <section className="min-w-0 bg-white px-5 py-5 border-y border-slate-200">
        <div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase text-teal-700">Volume over time</p><h2 className="mt-1 text-lg font-bold text-slate-900">Sales trend</h2></div><TrendingUp className="h-5 w-5 text-teal-600" /></div>
        <p className="mt-2 text-xs text-slate-500">{period === 'all' || period === 'year' ? 'Monthly totals. Boundary months may be partial.' : 'Daily net tonnes in the selected period.'}</p>
        <div className="mt-4 h-72">{report.trend.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={report.trend} margin={{ top: 15, right: 10, left: -15, bottom: 5 }}><CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" /><XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} minTickGap={25} /><YAxis tickLine={false} axisLine={false} fontSize={11} /><Tooltip formatter={(value) => [`${tonnes.format(Number(value || 0))} t`, 'Net tonnes']} labelFormatter={(_label, payload) => payload?.[0]?.payload?.sort || _label} cursor={{ fill: '#f1f5f9' }} /><Bar dataKey="tonnes" fill="#0d9488" maxBarSize={64} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <Empty loading={loading} />}</div>
        <div className="mt-5 grid gap-4 border-t border-slate-200 pt-5 sm:grid-cols-3">
          <Insight label="Peak period" value={peak ? `${tonnes.format(peak.tonnes)} t` : '-'} note={peak?.sort || 'No sales'} />
          <Insight label="Daily average" value={coveredDays ? `${tonnes.format(report.totalTonnes / coveredDays)} t` : '-'} note={`${coveredDays} calendar days in available coverage`} />
          <Insight label="Leading category" value={report.categories[0]?.label || '-'} note={leadingShare === null ? 'Share unavailable' : `${leadingShare.toFixed(1)}% of net tonnes`} />
        </div>
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-100 pt-4">{report.channels.map((item, index) => <div key={item.label} className="flex items-center gap-2 text-xs"><span className={`h-2 w-2 rounded-full ${index ? 'bg-blue-600' : 'bg-teal-600'}`} /><span className="text-slate-500">{item.label}</span><strong className="text-slate-800">{tonnes.format(item.tonnes)} t</strong></div>)}</div>
      </section>
      <section className="min-w-0 border-y border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase text-blue-700">Branch contribution</p><h2 className="mt-1 text-lg font-bold text-slate-900">Tonnes by branch</h2></div><span className="text-xs text-slate-500">Top {Math.min(8, report.branches.length)}</span></div><div className="mt-5 space-y-3">{report.branches.slice(0, 8).map((item, index) => <div key={item.label} className="flex gap-3"><span className="w-5 pt-1 text-xs font-semibold text-slate-400">{String(index + 1).padStart(2, '0')}</span><div className="min-w-0 flex-1"><SummaryBar item={item} maximum={maxBranch} /></div></div>)}{!report.branches.length && <Empty loading={loading} />}</div></section>
    </div>

    <section className="border-y border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5"><div><p className="text-xs font-semibold uppercase text-teal-700">Product mix</p><h2 className="mt-1 text-lg font-bold text-slate-900">Category performance</h2></div><div className="text-xs text-slate-500">Top {Math.min(8, report.categories.length)} of {report.categories.length} categories <span className="mx-2 text-slate-300">/</span> Ranked by net tonnes</div></div>
      <div className="grid gap-x-8 px-5 pb-5 xl:grid-cols-2">{categoryCards.map((category, index) => {
        const maximum = Math.max(1, ...report.categories.map((item) => Math.abs(item.tonnes)));
        const width = Math.min(100, Math.abs(category.tonnes) / maximum * 100);
        return <details key={category.label} className="group border-t border-slate-100">
          <summary className="flex cursor-pointer list-none items-center gap-3 py-4 [&::-webkit-details-marker]:hidden">
            <span className="w-5 text-xs font-semibold text-slate-400">{String(index + 1).padStart(2, '0')}</span>
            <div className="min-w-0 flex-1"><div className="flex items-baseline justify-between gap-3"><strong className="break-words text-sm text-slate-900">{category.label}</strong><span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{tonnes.format(category.tonnes)} <span className="font-normal text-slate-400">t</span></span></div><div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-slate-100"><div className={`h-full ${category.tonnes < 0 ? 'bg-rose-500' : index % 2 ? 'bg-blue-500' : 'bg-teal-500'}`} style={{ width: `${width}%` }} /></div><div className="mt-2 flex flex-wrap justify-between gap-2 text-[11px] text-slate-500"><span>Sales value {money.format(category.value)}</span><span>{report.totalTonnes > 0 ? `${(category.tonnes / report.totalTonnes * 100).toFixed(1)}% of net tonnes` : 'Share unavailable'}</span></div></div>
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
          </summary>
          <div className="mb-4 ml-8 border-l-2 border-teal-200 pl-4"><p className="mb-2 text-[11px] font-semibold uppercase text-slate-500">Leading branches</p>{category.branches.map(([branch, value]) => <div key={branch} className="flex justify-between gap-4 py-1 text-xs"><span className="text-slate-600">{branch}</span><strong className="tabular-nums text-slate-800">{tonnes.format(value)} t</strong></div>)}<p className="mt-2 text-xs text-slate-400">{category.rows.toLocaleString()} reporting rows</p></div>
        </details>;
      })}{!categoryCards.length && <Empty loading={loading} />}</div>
    </section>

    <section className="border-y border-slate-200 bg-white">
      <div className="flex flex-col justify-between gap-4 p-5 md:flex-row md:items-center"><div><p className="text-xs font-semibold uppercase text-blue-700">Sales breakdown</p><h2 className="mt-1 text-lg font-bold text-slate-900">Sales data explorer</h2></div><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input aria-label="Filter report by branch, category or channel" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Branch, category, or channel" className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm md:w-72" /></div></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-slate-100 bg-slate-50 px-5 py-3"><div className="flex gap-4"><button type="button" aria-pressed={explorerMode === 'branches'} onClick={() => setExplorerMode('branches')} className={`border-b-2 pb-1 text-xs font-bold ${explorerMode === 'branches' ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500'}`}>Branches <span className="ml-1 font-normal">{report.branches.length}</span></button><button type="button" aria-pressed={explorerMode === 'categories'} onClick={() => setExplorerMode('categories')} className={`border-b-2 pb-1 text-xs font-bold ${explorerMode === 'categories' ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500'}`}>Categories <span className="ml-1 font-normal">{report.categories.length}</span></button></div><span className="text-xs text-slate-500">{visible.length.toLocaleString()} reporting rows</span></div>
      <div className="max-h-72 overflow-auto"><table className="w-full min-w-[520px] text-sm"><thead className="sticky top-0 bg-white text-left text-[11px] uppercase text-slate-500"><tr><th className="px-5 py-3">{explorerMode === 'branches' ? 'Branch' : 'Category'}</th><th className="px-5 py-3 text-right">Net tonnes</th><th className="px-5 py-3 text-right">Sales value</th><th className="px-5 py-3 text-right">Rows</th></tr></thead><tbody className="divide-y divide-slate-100">{explorerSummary.map((item) => <tr key={item.label} className="hover:bg-teal-50/50"><td className="px-5 py-2.5 font-semibold text-slate-800">{item.label}</td><td className="px-5 py-2.5 text-right font-semibold tabular-nums text-teal-700">{tonnes.format(item.tonnes)}</td><td className="px-5 py-2.5 text-right tabular-nums text-slate-700">{money.format(item.value)}</td><td className="px-5 py-2.5 text-right tabular-nums text-slate-500">{item.rows.toLocaleString()}</td></tr>)}{!explorerSummary.length && <tr><td colSpan={4}><Empty loading={loading} /></td></tr>}</tbody></table></div>
      <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)} className="flex w-full items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><span>{detailsOpen ? 'Hide source detail' : 'Source detail'} <span className="ml-2 text-xs font-normal text-slate-400">{visible.length.toLocaleString()} rows</span></span><ChevronDown className={`h-4 w-4 transition ${detailsOpen ? 'rotate-180' : ''}`} /></button>
      {detailsOpen && <><div className="max-h-[400px] overflow-auto"><table className="w-full min-w-[850px] text-xs"><thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase text-slate-500"><tr><th className="px-5 py-3">Date</th><th className="px-5 py-3">Branch / warehouse</th><th className="px-5 py-3">Product group</th><th className="px-5 py-3">Channel</th><th className="px-5 py-3 text-right">Tonnes</th><th className="px-5 py-3 text-right">Sales value</th></tr></thead><tbody className="divide-y divide-slate-100">{details.map((row) => <tr key={row.id} className="hover:bg-slate-50"><td className="whitespace-nowrap px-5 py-2.5 text-slate-500">{row.invoice_date}</td><td className="px-5 py-2.5"><p className="font-semibold text-slate-800">{row.warehouse_code || 'HQ'}</p><p className="text-[11px] text-slate-400">{row.warehouse_name}</p></td><td className="px-5 py-2.5 font-semibold text-slate-800">{row.reporting_category || row.category}</td><td className="px-5 py-2.5 text-slate-500">{row.transaction_type}</td><td className={`px-5 py-2.5 text-right font-semibold tabular-nums ${Number(row.total_tonnes) < 0 ? 'text-rose-600' : 'text-slate-800'}`}>{tonnes.format(Number(row.total_tonnes))}</td><td className="px-5 py-2.5 text-right tabular-nums">{money.format(Number(row.total_sales_amount))}</td></tr>)}{!details.length && <tr><td colSpan={6}><Empty loading={loading} /></td></tr>}</tbody></table></div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3"><p className="text-xs text-slate-500">{visible.length ? `Showing ${detailPage * DETAIL_SIZE + 1}-${Math.min((detailPage + 1) * DETAIL_SIZE, visible.length)} of ${visible.length.toLocaleString()}` : 'No matching rows'}</p><div className="flex items-center gap-2"><button type="button" title="Previous detail page" onClick={() => setDetailPage((page) => Math.max(0, page - 1))} disabled={detailPage === 0} className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><span className="min-w-20 text-center text-xs font-semibold">Page {detailPage + 1} / {pageCount}</span><button type="button" title="Next detail page" onClick={() => setDetailPage((page) => Math.min(pageCount - 1, page + 1))} disabled={detailPage >= pageCount - 1} className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div></>}
    </section>
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
function Insight({ label, value, note }: { label: string; value: string; note: string }) { return <div className="min-w-0"><p className="text-[11px] font-semibold uppercase text-slate-500">{label}</p><p className="mt-2 break-words text-xl font-bold tabular-nums text-slate-900">{value}</p><p className="mt-1 text-xs leading-5 text-slate-500">{note}</p></div>; }
function SummaryBar({ item, maximum }: { item: Summary; maximum: number }) { return <div><div className="flex items-baseline justify-between gap-4 text-sm"><span className="font-semibold text-slate-800">{item.label}</span><span className="font-mono text-slate-900">{tonnes.format(item.tonnes)} t</span></div><div className="mt-2 h-2 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, Math.abs(item.tonnes) / maximum * 100))}%` }} /></div><p className="mt-1 text-xs text-slate-500">{money.format(item.value)} | {item.rows.toLocaleString()} rows</p></div>; }
function Empty({ loading }: { loading: boolean }) { return <div className="grid min-h-32 place-items-center text-sm text-slate-400">{loading ? 'Loading Sage reporting data...' : 'No Sage reporting rows match this view.'}</div>; }
