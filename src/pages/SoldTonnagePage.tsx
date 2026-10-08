import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarDays, ChevronLeft, ChevronRight, Landmark, RefreshCw, Search, TrendingUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

type Sale = {
  id: string;
  invoice_date: string;
  warehouse_code: string;
  warehouse_name: string;
  reporting_category: string;
  category: string;
  sub_category: string;
  transaction_type: string;
  total_tonnes: number;
  total_sales_amount: number;
  line_count: number;
  imported_at: string;
};

type Period = 'all' | 'day' | 'week' | 'month' | 'year' | 'custom';
type Channel = 'all' | 'Branch POS' | 'HQ Invoiced';
type Summary = { label: string; tonnes: number; value: number; rows: number };

const PAGE_SIZE = 1000;
const DETAIL_PAGE_SIZE = 30;
const money = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tonnes = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const periodLabels: Record<Period, string> = { all: 'All time', day: 'Day', week: 'Week', month: 'Month', year: 'Year', custom: 'Custom' };

function shiftDate(date: string, days: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function monthLabel(month: string) {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

export default function SoldTonnagePage() {
  const [rows, setRows] = useState<Sale[]>([]);
  const [period, setPeriod] = useState<Period>('all');
  const [channel, setChannel] = useState<Channel>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');
  const [detailPage, setDetailPage] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const allRows: Sale[] = [];
    try {
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from('sage_sold_tonnage_daily')
          .select('*')
          .order('invoice_date', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        const page = (data || []) as Sale[];
        allRows.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
      setRows(allRows);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown reporting error';
      toast.error(`Could not load Sage sales reporting: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const dataBounds = useMemo(() => ({
    newest: rows[0]?.invoice_date || '',
    oldest: rows.length ? rows[rows.length - 1].invoice_date : '',
  }), [rows]);

  const dateBounds = useMemo(() => {
    const anchor = dataBounds.newest;
    if (!anchor) return { from: '', to: '' };
    if (period === 'day') return { from: anchor, to: anchor };
    if (period === 'week') return { from: shiftDate(anchor, -6), to: anchor };
    if (period === 'month') return { from: `${anchor.slice(0, 7)}-01`, to: anchor };
    if (period === 'year') return { from: `${anchor.slice(0, 4)}-01-01`, to: anchor };
    if (period === 'custom') return { from: fromDate, to: toDate };
    return { from: dataBounds.oldest, to: anchor };
  }, [dataBounds, fromDate, period, toDate]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (dateBounds.from && row.invoice_date < dateBounds.from) return false;
      if (dateBounds.to && row.invoice_date > dateBounds.to) return false;
      if (channel !== 'all' && row.transaction_type !== channel) return false;
      if (!query) return true;
      return [row.warehouse_code, row.warehouse_name, row.reporting_category, row.category, row.sub_category, row.transaction_type]
        .join(' ').toLowerCase().includes(query);
    });
  }, [channel, dateBounds, rows, search]);

  useEffect(() => { setDetailPage(0); }, [channel, dateBounds.from, dateBounds.to, search]);

  const report = useMemo(() => {
    const channels = new Map<string, Summary>();
    const categories = new Map<string, Summary>();
    const branches = new Map<string, Summary>();
    const matrix = new Map<string, Map<string, number>>();
    const trend = new Map<string, { sort: string; label: string; tonnes: number; value: number }>();
    let totalTonnes = 0; let totalValue = 0; let reversals = 0; let latestImport = '';
    const bucketByMonth = period === 'all' || period === 'year';

    visible.forEach((row) => {
      const rowTonnes = Number(row.total_tonnes || 0);
      const rowValue = Number(row.total_sales_amount || 0);
      totalTonnes += rowTonnes; totalValue += rowValue;
      if (rowTonnes < 0 || rowValue < 0) reversals += 1;
      if (row.imported_at > latestImport) latestImport = row.imported_at;

      addSummary(channels, row.transaction_type || 'Other', rowTonnes, rowValue);
      const categoryLabel = row.reporting_category || row.category || 'Unclassified';
      addSummary(categories, categoryLabel, rowTonnes, rowValue);
      const branchLabel = row.warehouse_code || 'HQ';
      addSummary(branches, branchLabel, rowTonnes, rowValue);

      const categoryRows = matrix.get(categoryLabel) || new Map<string, number>();
      categoryRows.set(branchLabel, (categoryRows.get(branchLabel) || 0) + rowTonnes);
      matrix.set(categoryLabel, categoryRows);

      const bucket = bucketByMonth ? row.invoice_date.slice(0, 7) : row.invoice_date;
      const item = trend.get(bucket) || { sort: bucket, label: bucketByMonth ? monthLabel(bucket) : bucket.slice(5), tonnes: 0, value: 0 };
      item.tonnes += rowTonnes; item.value += rowValue;
      trend.set(bucket, item);
    });

    const categoryList = [...categories.values()].sort((a, b) => b.tonnes - a.tonnes);
    const branchList = [...branches.values()].sort((a, b) => b.tonnes - a.tonnes);
    return {
      totalTonnes, totalValue, reversals, latestImport,
      channels: [...channels.values()].sort((a, b) => b.tonnes - a.tonnes),
      categories: categoryList.slice(0, 8),
      branches: branchList.slice(0, 10),
      matrixCategories: categoryList.slice(0, 8),
      matrixBranches: branchList.slice(0, 6),
      matrix,
      trend: [...trend.values()].sort((a, b) => a.sort.localeCompare(b.sort)),
    };
  }, [period, visible]);

  const pageCount = Math.max(1, Math.ceil(visible.length / DETAIL_PAGE_SIZE));
  const detailRows = visible.slice(detailPage * DETAIL_PAGE_SIZE, (detailPage + 1) * DETAIL_PAGE_SIZE);
  const latestImport = report.latestImport ? new Date(report.latestImport).toLocaleString() : 'Not yet imported';
  const maxChannelTonnes = Math.max(...report.channels.map((item) => Math.abs(item.tonnes)), 1);
  const maxBranchTonnes = Math.max(...report.branches.map((item) => Math.abs(item.tonnes)), 1);

  return <div className="min-h-[calc(100vh-4rem)] bg-slate-50 p-4 md:p-6"><div className="mx-auto max-w-[1500px] space-y-5">
    <section className="overflow-hidden rounded-lg border border-slate-900 bg-slate-900 text-white shadow-lg">
      <div className="flex flex-col gap-5 px-6 py-6 xl:flex-row xl:items-end xl:justify-between">
        <div><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-cyan-300"><Landmark className="h-4 w-4" /> Sage reporting</p><h1 className="mt-2 text-2xl font-bold">Sold Tonnage</h1><p className="mt-1 text-sm text-slate-300">Sales performance from the Power BI reporting view, retained in PlantControl for operational reporting.</p></div>
        <div className="flex items-center gap-4"><div className="text-right text-xs text-slate-300"><p className="font-semibold text-white">{dateBounds.from && dateBounds.to ? `${dateBounds.from} to ${dateBounds.to}` : 'No imported period'}</p><p>Latest import: {latestImport}</p></div><button type="button" title="Refresh reporting data" onClick={() => void load()} disabled={loading} className="grid h-10 w-10 place-items-center rounded-md border border-slate-600 text-white transition hover:border-cyan-300 hover:text-cyan-200 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div>
      </div>
      <div className="grid border-t border-slate-700 sm:grid-cols-2 lg:grid-cols-4"><HeroMetric label="Net tonnes" value={`${tonnes.format(report.totalTonnes)} t`} /><HeroMetric label="Net sales value" value={money.format(report.totalValue)} /><HeroMetric label="Sales records" value={visible.length.toLocaleString()} /><HeroMetric label="Credit / reversal rows" value={report.reversals.toLocaleString()} /></div>
    </section>

    <section className="border-b border-slate-200 bg-white px-5 py-4 shadow-sm"><div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"><div className="space-y-2"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Reporting period</p><div className="flex flex-wrap gap-2">{(['day', 'week', 'month', 'year', 'all', 'custom'] as Period[]).map((item) => <button key={item} type="button" onClick={() => setPeriod(item)} className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${period === item ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-teal-400'}`}>{periodLabels[item]}</button>)}</div></div><div className="space-y-2"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Sales channel</p><div className="flex flex-wrap gap-2">{(['all', 'Branch POS', 'HQ Invoiced'] as Channel[]).map((item) => <button key={item} type="button" onClick={() => setChannel(item)} className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${channel === item ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-400'}`}>{item === 'all' ? 'All channels' : item}</button>)}</div></div></div>{period === 'custom' && <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4"><label className="grid gap-1 text-xs font-semibold text-slate-500">From<input type="date" value={fromDate} max={dataBounds.newest} onChange={(event) => setFromDate(event.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800" /></label><label className="grid gap-1 text-xs font-semibold text-slate-500">To<input type="date" value={toDate} min={fromDate || dataBounds.oldest} max={dataBounds.newest} onChange={(event) => setToDate(event.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800" /></label><p className="pb-2 text-xs text-slate-500">Available data: {dataBounds.oldest || '-'} to {dataBounds.newest || '-'}</p></div>}</section>

    <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]"><section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-900">Sales trend</h2><p className="mt-1 text-xs text-slate-500">{period === 'all' || period === 'year' ? 'Monthly' : 'Daily'} net tonnage for the selected period.</p></div><TrendingUp className="h-5 w-5 text-teal-600" /></div><div className="mt-4 h-64">{report.trend.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={report.trend} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e2e8f0" /><XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} /><YAxis tickLine={false} axisLine={false} fontSize={12} /><Tooltip formatter={(value: number) => [`${tonnes.format(value)} t`, 'Net tonnes']} cursor={{ fill: '#f1f5f9' }} /><Bar dataKey="tonnes" fill="#0d9488" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <EmptyState loading={loading} />}</div></section><section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-900">Sales channels</h2><p className="mt-1 text-xs text-slate-500">Branch POS and HQ-invoiced performance.</p><div className="mt-5 space-y-4">{report.channels.map((item) => <SummaryBar key={item.label} item={item} maximum={maxChannelTonnes} />)}{!report.channels.length && <EmptyState loading={loading} />}</div></section></div>

    <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]"><section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-200 p-4"><div><h2 className="font-bold text-slate-900">Tonnage by category and branch</h2><p className="mt-1 text-xs text-slate-500">Leading categories across the six highest-volume branches.</p></div><CalendarDays className="h-5 w-5 text-slate-400" /></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-slate-50 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="sticky left-0 bg-slate-50 px-4 py-3 text-left">Category</th>{report.matrixBranches.map((branch) => <th key={branch.label} className="px-3 py-3">{branch.label}</th>)}<th className="px-4 py-3">Total</th></tr></thead><tbody className="divide-y divide-slate-100">{report.matrixCategories.map((category) => <tr key={category.label}><td className="sticky left-0 bg-white px-4 py-3 font-semibold text-slate-900">{category.label}</td>{report.matrixBranches.map((branch) => <td key={branch.label} className="px-3 py-3 text-right font-mono text-slate-600">{tonnes.format(report.matrix.get(category.label)?.get(branch.label) || 0)}</td>)}<td className="px-4 py-3 text-right font-mono font-bold text-slate-900">{tonnes.format(category.tonnes)}</td></tr>)}{!report.matrixCategories.length && <tr><td colSpan={8}><EmptyState loading={loading} /></td></tr>}</tbody></table></div></section><section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-900">Tonnes by branch</h2><p className="mt-1 text-xs text-slate-500">Top warehouse codes for the selected period.</p><div className="mt-5 space-y-3">{report.branches.map((branch) => <SummaryBar key={branch.label} item={branch} maximum={maxBranchTonnes} />)}{!report.branches.length && <EmptyState loading={loading} />}</div></section></div>

    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between"><div><h2 className="font-bold text-slate-900">Sales data explorer</h2><p className="text-xs text-slate-500">Page through precise reporting rows without expanding the whole page.</p></div><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Branch, category, or channel" className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm md:w-72" /></div></div><div className="overflow-x-auto"><table className="w-full min-w-[940px] text-sm"><thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Branch / warehouse</th><th className="px-4 py-3">Product group</th><th className="px-4 py-3">Channel</th><th className="px-4 py-3 text-right">Tonnes</th><th className="px-4 py-3 text-right">Sales value</th></tr></thead><tbody className="divide-y divide-slate-100">{detailRows.map((row) => <tr key={row.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-mono text-xs">{row.invoice_date}</td><td className="px-4 py-3"><p className="font-semibold text-slate-900">{row.warehouse_code || 'HQ'}</p><p className="text-xs text-slate-500">{row.warehouse_name}</p></td><td className="px-4 py-3"><p className="font-semibold">{row.reporting_category || row.category}</p><p className="text-xs text-slate-500">{row.sub_category}</p></td><td className="px-4 py-3">{row.transaction_type}</td><td className={`px-4 py-3 text-right font-mono font-bold ${Number(row.total_tonnes) < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{tonnes.format(Number(row.total_tonnes))}</td><td className={`px-4 py-3 text-right font-mono ${Number(row.total_sales_amount) < 0 ? 'text-rose-700' : 'text-slate-800'}`}>{money.format(Number(row.total_sales_amount))}</td></tr>)}{!detailRows.length && <tr><td colSpan={6}><EmptyState loading={loading} /></td></tr>}</tbody></table></div><div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-500">{visible.length ? `Showing ${detailPage * DETAIL_PAGE_SIZE + 1}-${Math.min((detailPage + 1) * DETAIL_PAGE_SIZE, visible.length)} of ${visible.length.toLocaleString()} rows` : 'No rows match this view.'}</p><div className="flex items-center gap-2"><button type="button" title="Previous detail page" onClick={() => setDetailPage((page) => Math.max(0, page - 1))} disabled={detailPage === 0} className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-600 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><span className="min-w-20 text-center text-xs font-semibold text-slate-700">Page {detailPage + 1} / {pageCount}</span><button type="button" title="Next detail page" onClick={() => setDetailPage((page) => Math.min(pageCount - 1, page + 1))} disabled={detailPage >= pageCount - 1} className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-600 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div></section>
  </div></div>;
}

function addSummary(map: Map<string, Summary>, label: string, rowTonnes: number, rowValue: number) {
  const item = map.get(label) || { label, tonnes: 0, value: 0, rows: 0 };
  item.tonnes += rowTonnes; item.value += rowValue; item.rows += 1;
  map.set(label, item);
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return <div className="border-b border-slate-700 px-6 py-4 last:border-b-0 sm:nth-[2]:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-2 text-2xl font-bold text-white">{value}</p></div>;
}

function SummaryBar({ item, maximum }: { item: Summary; maximum: number }) {
  return <div><div className="flex items-baseline justify-between gap-4 text-sm"><span className="font-semibold text-slate-800">{item.label}</span><span className="font-mono text-slate-900">{tonnes.format(item.tonnes)} t</span></div><div className="mt-2 h-2 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, Math.abs(item.tonnes) / maximum * 100))}%` }} /></div><p className="mt-1 text-xs text-slate-500">{money.format(item.value)} | {item.rows.toLocaleString()} reporting rows</p></div>;
}

function EmptyState({ loading }: { loading: boolean }) {
  return <div className="grid min-h-32 place-items-center text-sm text-slate-400">{loading ? 'Loading Sage reporting data...' : 'No Sage reporting rows match this view.'}</div>;
}
