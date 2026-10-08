import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Landmark, RefreshCw, Search, TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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

type Summary = { label: string; tonnes: number; value: number; rows: number };

const PAGE_SIZE = 1000;
const money = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tonnes = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export default function SoldTonnagePage() {
  const [rows, setRows] = useState<Sale[]>([]);
  const [search, setSearch] = useState('');
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

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => [
      row.warehouse_code, row.warehouse_name, row.reporting_category,
      row.category, row.sub_category, row.transaction_type,
    ].join(' ').toLowerCase().includes(query));
  }, [rows, search]);

  const report = useMemo(() => {
    const channels = new Map<string, Summary>();
    const categories = new Map<string, Summary>();
    const months = new Map<string, { month: string; label: string; tonnes: number; value: number }>();
    let totalTonnes = 0;
    let totalValue = 0;
    let reversals = 0;
    let latestImport = '';

    visible.forEach((row) => {
      const rowTonnes = Number(row.total_tonnes || 0);
      const rowValue = Number(row.total_sales_amount || 0);
      totalTonnes += rowTonnes;
      totalValue += rowValue;
      if (rowTonnes < 0 || rowValue < 0) reversals += 1;
      if (row.imported_at > latestImport) latestImport = row.imported_at;

      const channel = channels.get(row.transaction_type) || { label: row.transaction_type || 'Other', tonnes: 0, value: 0, rows: 0 };
      channel.tonnes += rowTonnes; channel.value += rowValue; channel.rows += 1;
      channels.set(channel.label, channel);

      const categoryLabel = row.reporting_category || row.category || 'Unclassified';
      const category = categories.get(categoryLabel) || { label: categoryLabel, tonnes: 0, value: 0, rows: 0 };
      category.tonnes += rowTonnes; category.value += rowValue; category.rows += 1;
      categories.set(categoryLabel, category);

      const month = row.invoice_date.slice(0, 7);
      const monthly = months.get(month) || {
        month,
        label: new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
        tonnes: 0,
        value: 0,
      };
      monthly.tonnes += rowTonnes;
      monthly.value += rowValue;
      months.set(month, monthly);
    });

    return {
      totalTonnes, totalValue, reversals, latestImport,
      channels: [...channels.values()].sort((a, b) => b.tonnes - a.tonnes),
      categories: [...categories.values()].sort((a, b) => b.tonnes - a.tonnes).slice(0, 8),
      months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    };
  }, [visible]);

  const dateRange = rows.length ? `${rows[rows.length - 1].invoice_date} to ${rows[0].invoice_date}` : 'No imported period';
  const latestImport = report.latestImport ? new Date(report.latestImport).toLocaleString() : 'Not yet imported';
  const maxChannelTonnes = Math.max(...report.channels.map((channel) => Math.abs(channel.tonnes)), 1);

  return <div className="min-h-[calc(100vh-4rem)] bg-slate-50 p-4 md:p-6"><div className="mx-auto max-w-[1500px] space-y-5">
    <section className="overflow-hidden rounded-lg border border-slate-900 bg-slate-900 text-white shadow-lg">
      <div className="flex flex-col gap-5 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-cyan-300"><Landmark className="h-4 w-4" /> Sage reporting</p><h1 className="mt-2 text-2xl font-bold">Sold Tonnage</h1><p className="mt-1 text-sm text-slate-300">Net Branch POS and HQ-invoiced sales from the Power BI reporting view.</p></div>
        <div className="flex items-center gap-4"><div className="text-right text-xs text-slate-300"><p className="font-semibold text-white">{dateRange}</p><p>Latest import: {latestImport}</p></div><button type="button" title="Refresh reporting data" onClick={() => void load()} disabled={loading} className="grid h-10 w-10 place-items-center rounded-md border border-slate-600 text-white transition hover:border-cyan-300 hover:text-cyan-200 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div>
      </div>
      <div className="grid border-t border-slate-700 sm:grid-cols-2 lg:grid-cols-4"><HeroMetric label="Net tonnes" value={`${tonnes.format(report.totalTonnes)} t`} /><HeroMetric label="Net sales value" value={money.format(report.totalValue)} /><HeroMetric label="Sales records" value={visible.length.toLocaleString()} /><HeroMetric label="Credit / reversal rows" value={report.reversals.toLocaleString()} /></div>
    </section>

    <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-900">Monthly net tonnes</h2><p className="mt-1 text-xs text-slate-500">Net sales movements retained exactly as reported by Sage.</p></div><TrendingUp className="h-5 w-5 text-teal-600" /></div><div className="mt-4 h-64">{report.months.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={report.months} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e2e8f0" /><XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} /><YAxis tickLine={false} axisLine={false} fontSize={12} /><Tooltip formatter={(value: number) => [`${tonnes.format(value)} t`, 'Net tonnes']} cursor={{ fill: '#f1f5f9' }} /><Bar dataKey="tonnes" fill="#0d9488" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <EmptyState loading={loading} />}</div></section>
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-900">Sales channels</h2><p className="mt-1 text-xs text-slate-500">Source transaction types from Sage.</p></div><Landmark className="h-5 w-5 text-blue-600" /></div><div className="mt-5 space-y-4">{report.channels.map((channel) => <div key={channel.label}><div className="flex items-baseline justify-between gap-4 text-sm"><span className="font-semibold text-slate-800">{channel.label}</span><span className="font-mono text-slate-900">{tonnes.format(channel.tonnes)} t</span></div><div className="mt-2 h-2 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, Math.abs(channel.tonnes) / maxChannelTonnes * 100))}%` }} /></div><p className="mt-1 text-xs text-slate-500">{money.format(channel.value)} | {channel.rows.toLocaleString()} reporting rows</p></div>)}{!report.channels.length && <EmptyState loading={loading} />}</div></section>
    </div>

    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between"><div><h2 className="font-bold text-slate-900">Product category performance</h2><p className="text-xs text-slate-500">Top categories by net tonnes in the current view.</p></div><CalendarDays className="hidden h-5 w-5 text-slate-400 md:block" /></div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Reporting category</th><th className="px-4 py-3 text-right">Net tonnes</th><th className="px-4 py-3 text-right">Net sales value</th><th className="px-4 py-3 text-right">Reporting rows</th></tr></thead><tbody className="divide-y divide-slate-100">{report.categories.map((category) => <tr key={category.label}><td className="px-4 py-3 font-semibold text-slate-900">{category.label}</td><td className={`px-4 py-3 text-right font-mono font-bold ${category.tonnes < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{tonnes.format(category.tonnes)} t</td><td className={`px-4 py-3 text-right font-mono ${category.value < 0 ? 'text-rose-700' : 'text-slate-800'}`}>{money.format(category.value)}</td><td className="px-4 py-3 text-right font-mono text-slate-600">{category.rows.toLocaleString()}</td></tr>)}{!report.categories.length && <tr><td colSpan={4}><EmptyState loading={loading} /></td></tr>}</tbody></table></div></section>

    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between"><div><h2 className="font-bold text-slate-900">Sage sales detail</h2><p className="text-xs text-slate-500">Search preserves the management totals, category analysis, and detail below.</p></div><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Branch, category, or channel" className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm md:w-72" /></div></div><div className="overflow-x-auto"><table className="w-full min-w-[940px] text-sm"><thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Branch / warehouse</th><th className="px-4 py-3">Product group</th><th className="px-4 py-3">Channel</th><th className="px-4 py-3 text-right">Tonnes</th><th className="px-4 py-3 text-right">Sales value</th></tr></thead><tbody className="divide-y divide-slate-100">{visible.slice(0, 500).map((row) => <tr key={row.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-mono text-xs">{row.invoice_date}</td><td className="px-4 py-3"><p className="font-semibold text-slate-900">{row.warehouse_code || 'HQ'}</p><p className="text-xs text-slate-500">{row.warehouse_name}</p></td><td className="px-4 py-3"><p className="font-semibold">{row.reporting_category || row.category}</p><p className="text-xs text-slate-500">{row.sub_category}</p></td><td className="px-4 py-3">{row.transaction_type}</td><td className={`px-4 py-3 text-right font-mono font-bold ${Number(row.total_tonnes) < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{tonnes.format(Number(row.total_tonnes))}</td><td className={`px-4 py-3 text-right font-mono ${Number(row.total_sales_amount) < 0 ? 'text-rose-700' : 'text-slate-800'}`}>{money.format(Number(row.total_sales_amount))}</td></tr>)}{!visible.length && <tr><td colSpan={6}><EmptyState loading={loading} /></td></tr>}</tbody></table></div>{visible.length > 500 && <p className="border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-500">Showing the first 500 detail rows. Management totals above include all {visible.length.toLocaleString()} matching rows.</p>}</section>
  </div></div>;
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return <div className="border-b border-slate-700 px-6 py-4 last:border-b-0 sm:nth-[2]:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-2 text-2xl font-bold text-white">{value}</p></div>;
}

function EmptyState({ loading }: { loading: boolean }) {
  return <div className="grid min-h-32 place-items-center text-sm text-slate-400">{loading ? 'Loading Sage reporting data...' : 'No Sage reporting rows match this view.'}</div>;
}
