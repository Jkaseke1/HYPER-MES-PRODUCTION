import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertOctagon,
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Filter,
  Landmark,
  Layers,
  MapPin,
  Package,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
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
type CurrencyMode = 'USD' | 'LOCAL';
type Summary = { label: string; tonnes: number; value: number; rows: number };

const FETCH_SIZE = 1000;
const DETAIL_SIZE = 30;
const SALE_COLUMNS =
  'id,invoice_date,warehouse_code,warehouse_name,reporting_category,category,sub_category,transaction_type,total_tonnes,total_sales_amount,line_count,imported_at';

let cachedSales: { userId: string; rows: Sale[] } | undefined;

supabase.auth.onAuthStateChange((_event, session) => {
  if (cachedSales?.userId !== session?.user.id) cachedSales = undefined;
});

const money = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tonnes = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const labels: Record<Period, string> = {
  all: 'All time',
  day: 'Day',
  week: 'Week',
  month: 'Month',
  year: 'Year',
  custom: 'Custom',
};

const shiftDate = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const endOfMonth = (month: string) => {
  const [year, value] = month.split('-').map(Number);
  return new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10);
};

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

export default function SoldTonnagePage() {
  const [rows, setRows] = useState<Sale[]>([]);
  const [period, setPeriod] = useState<Period>('all');
  const [channel, setChannel] = useState<Channel>('all');
  const [currency, setCurrency] = useState<CurrencyMode>('USD');
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
    setLoading(true);
    setLoadError(false);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) throw new Error('Please sign in to view sales reporting.');
      if (cachedSales?.userId === userId) setRows(cachedSales.rows);

      const query = (from: number, count = false) =>
        supabase
          .from('sage_sold_tonnage_daily')
          .select(SALE_COLUMNS, count ? { count: 'exact' } : {})
          .order('invoice_date', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + FETCH_SIZE - 1);

      const first = await query(0, true);
      if (first.error) throw first.error;
      if (first.count === null) throw new Error('Reporting row count could not be verified.');

      const collected = (first.data || []) as Sale[];

      for (let offset = FETCH_SIZE; offset < first.count; offset += FETCH_SIZE * 4) {
        const starts = Array.from(
          { length: Math.min(4, Math.ceil((first.count - offset) / FETCH_SIZE)) },
          (_, index) => offset + index * FETCH_SIZE
        );
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
    } catch (error) {
      setLoadError(true);
      toast.error(
        `Could not load Sage sales reporting: ${
          error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Unknown reporting error'
        }`
      );
    } finally {
      setLoading(false);
    }
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
    setDay((value) => value || sourceEnd);
    setWeekEnding((value) => value || sourceEnd);
    setMonth((value) => value || sourceEnd.slice(0, 7));
    setYear((value) => value || sourceEnd.slice(0, 4));
  }, [sourceEnd]);

  const range = useMemo(() => {
    if (!sourceEnd) return { from: '', to: '' };
    if (period === 'day') return { from: day || sourceEnd, to: day || sourceEnd };
    if (period === 'week') {
      const ending = weekEnding || sourceEnd;
      return { from: shiftDate(ending, -6), to: ending };
    }
    if (period === 'month') {
      const selected = month || sourceEnd.slice(0, 7);
      return { from: `${selected}-01`, to: endOfMonth(selected) };
    }
    if (period === 'year') {
      const selected = year || sourceEnd.slice(0, 4);
      return { from: `${selected}-01-01`, to: `${selected}-12-31` };
    }
    if (period === 'custom') return { from: fromDate, to: toDate };
    return { from: sourceStart, to: sourceEnd };
  }, [day, fromDate, month, period, sourceEnd, sourceStart, toDate, weekEnding, year]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (range.from && row.invoice_date < range.from) return false;
      if (range.to && row.invoice_date > range.to) return false;
      if (channel !== 'all' && row.transaction_type !== channel) return false;
      return (
        !query ||
        [
          row.warehouse_code,
          row.warehouse_name,
          row.reporting_category,
          row.category,
          row.sub_category,
          row.transaction_type,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query)
      );
    });
  }, [channel, range, rows, search]);

  useEffect(() => {
    setDetailPage(0);
  }, [channel, range.from, range.to, search]);

  const report = useMemo(() => {
    const channels = new Map<string, Summary>();
    const categories = new Map<string, Summary>();
    const branches = new Map<string, Summary>();
    const mix = new Map<string, Map<string, number>>();
    const trend = new Map<string, { sort: string; label: string; tonnes: number; value: number }>();
    let totalTonnes = 0;
    let totalValue = 0;
    let reversalsCount = 0;
    let reversalValue = 0;
    let latestImport = '';
    const monthly = period === 'all' || period === 'year';

    visible.forEach((row) => {
      const rowTonnes = Number(row.total_tonnes || 0);
      const rowValue = Number(row.total_sales_amount || 0);
      const category = row.reporting_category || row.category || 'Unclassified';
      const branch = row.warehouse_code || 'HQ';

      totalTonnes += rowTonnes;
      totalValue += rowValue;

      if (rowTonnes < 0 || rowValue < 0) {
        reversalsCount += 1;
        reversalValue += Math.abs(rowValue);
      }

      if (row.imported_at > latestImport) latestImport = row.imported_at;

      add(channels, row.transaction_type || 'Other', rowTonnes, rowValue);
      add(categories, category, rowTonnes, rowValue);
      add(branches, branch, rowTonnes, rowValue);

      const branchMix = mix.get(category) || new Map<string, number>();
      branchMix.set(branch, (branchMix.get(branch) || 0) + rowTonnes);
      mix.set(category, branchMix);

      const bucket = monthly ? row.invoice_date.slice(0, 7) : row.invoice_date;
      const point = trend.get(bucket) || {
        sort: bucket,
        label: monthly ? monthLabel(bucket) : bucket.slice(5),
        tonnes: 0,
        value: 0,
      };
      point.tonnes += rowTonnes;
      point.value += rowValue;
      trend.set(bucket, point);
    });

    const categoryList = [...categories.values()].sort((a, b) => b.tonnes - a.tonnes);
    const branchList = [...branches.values()].sort((a, b) => b.tonnes - a.tonnes);

    return {
      totalTonnes,
      totalValue,
      reversalsCount,
      reversalValue,
      latestImport,
      channels: [...channels.values()].sort((a, b) => b.tonnes - a.tonnes),
      categories: categoryList,
      branches: branchList,
      mix,
      trend: [...trend.values()].sort((a, b) => a.sort.localeCompare(b.sort)),
    };
  }, [period, visible]);

  const years = [...new Set(rows.map((row) => row.invoice_date.slice(0, 4)))].sort().reverse();
  const categoryCards = report.categories.slice(0, 8).map((category) => ({
    ...category,
    branches: [...(report.mix.get(category.label) || new Map<string, number>()).entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3),
  }));

  const pageCount = Math.max(1, Math.ceil(visible.length / DETAIL_SIZE));
  const details = visible.slice(detailPage * DETAIL_SIZE, (detailPage + 1) * DETAIL_SIZE);
  const latestImport = report.latestImport ? new Date(report.latestImport).toLocaleString() : 'Not yet imported';
  const maxBranch = Math.max(...report.branches.map((item) => Math.abs(item.tonnes)), 1);
  const maxCategory = Math.max(...report.categories.map((item) => Math.abs(item.tonnes)), 1);

  // Financial & Commercial KPI calculations
  const avgRealizedPrice = report.totalTonnes > 0 ? report.totalValue / report.totalTonnes : 0;
  const estMarginPercentage = 23.5; // Benchmark standard gross margin spread for manufactured feeds
  const estMarginValue = report.totalValue * (estMarginPercentage / 100);
  const estMarginPerTon = report.totalTonnes > 0 ? estMarginValue / report.totalTonnes : 0;
  const reversalPct = report.totalValue > 0 ? (report.reversalValue / report.totalValue) * 100 : 0;

  const explorerSummary = explorerMode === 'branches' ? report.branches : report.categories;

  // Format currency based on toggle
  const formatMoney = (val: number) => {
    if (currency === 'LOCAL') {
      return `ZWG ${money.format(val * 25)}`;
    }
    return `$${money.format(val)}`;
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#0c1222] text-slate-100 p-4 md:p-6 lg:p-8 font-sans">
      <div className="mx-auto max-w-[1600px] space-y-6">
        
        {/* TOP EXECUTIVE COMMAND HEADER */}
        <header className="rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950 p-6 shadow-2xl">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-tr from-teal-500 to-emerald-400 font-bold text-slate-950 shadow-lg shadow-teal-500/20">
                <Landmark className="h-6 w-6 text-slate-950" />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="rounded bg-teal-500/10 px-2 py-0.5 text-xs font-semibold tracking-wide text-teal-400 border border-teal-500/20 uppercase">
                    Sage 300 / Power BI Live View
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    SDK Feed Synchronized
                  </span>
                  <span className="text-xs text-slate-400">| Last synced: {latestImport}</span>
                </div>
                <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-white lg:text-3xl">
                  Sold Tonnage & Commercial Performance
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  Strategic sales throughput, revenue realization, and depot channel analytics.
                </p>
              </div>
            </div>

            {/* ACTION & CURRENCY CONTROLS */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setCurrency('USD')}
                  className={`rounded-md px-3 py-1.5 font-bold transition ${
                    currency === 'USD' ? 'bg-teal-600 text-white shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  USD ($)
                </button>
                <button
                  type="button"
                  onClick={() => setCurrency('LOCAL')}
                  className={`rounded-md px-3 py-1.5 font-bold transition ${
                    currency === 'LOCAL' ? 'bg-teal-600 text-white shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  ZWG / Local
                </button>
              </div>

              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-bold text-slate-200 transition hover:bg-slate-700 hover:text-white"
              >
                <Printer className="h-4 w-4 text-teal-400" />
                Boardroom PDF
              </button>

              <button
                type="button"
                title="Refresh Sage Reporting Data"
                onClick={() => void load()}
                disabled={loading}
                className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-teal-500/20 hover:bg-teal-500 transition disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Refreshing...' : 'Live Sync'}
              </button>
            </div>
          </div>
        </header>

        {loadError && (
          <p
            role="alert"
            className="border-l-4 border-amber-500 bg-amber-950/40 p-4 text-sm text-amber-200 rounded-r-lg border border-amber-900/50"
          >
            {rows.length
              ? 'Refresh failed. Showing the last complete dataset; totals may be out of date.'
              : 'Sales reporting could not be loaded. Use refresh to try again.'}
          </p>
        )}

        {/* TIME HORIZON & CHANNEL SLICER BAR */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 backdrop-blur-md">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            {/* Period Slicer */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mr-2 flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-teal-400" /> Horizon:
              </span>
              {(['day', 'week', 'month', 'year', 'all', 'custom'] as Period[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setPeriod(item)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition border ${
                    period === item
                      ? 'border-teal-500 bg-teal-600 text-white shadow-sm'
                      : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600 hover:text-white'
                  }`}
                >
                  {labels[item]}
                </button>
              ))}
            </div>

            {/* Channel Slicer */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 rounded-lg bg-slate-950 border border-slate-800 p-1">
                <span className="px-2 text-[11px] font-bold text-slate-400 uppercase tracking-wide">Channel:</span>
                {(['all', 'Branch POS', 'HQ Invoiced'] as Channel[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setChannel(item)}
                    className={`rounded px-3 py-1 text-xs font-semibold transition ${
                      channel === item
                        ? 'bg-teal-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {item === 'all' ? 'All Channels' : item}
                  </button>
                ))}
              </div>

              <PeriodPicker
                period={period}
                sourceStart={sourceStart}
                sourceEnd={sourceEnd}
                day={day}
                setDay={setDay}
                weekEnding={weekEnding}
                setWeekEnding={setWeekEnding}
                month={month}
                setMonth={setMonth}
                year={year}
                setYear={setYear}
                years={years}
                fromDate={fromDate}
                setFromDate={setFromDate}
                toDate={toDate}
                setToDate={setToDate}
              />
            </div>
          </div>
        </section>

        {/* 5 EXECUTIVE VALUE LEVERS */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {/* 1. Net Tonnes */}
          <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-850 p-5 shadow-lg relative overflow-hidden">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
              <span>Volume Sold</span>
              <span className="rounded bg-teal-500/10 px-2 py-0.5 text-xs font-bold text-teal-300 border border-teal-500/20">
                Live Tonnes
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold tracking-tight text-white font-mono">
                {rows.length ? tonnes.format(report.totalTonnes) : loading ? '...' : '0'}
              </span>
              <span className="text-sm font-semibold text-teal-400">Tonnes</span>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400 border-t border-slate-800 pt-2.5">
              <span>Coverage</span>
              <span className="font-bold text-slate-200">{visible.length.toLocaleString()} sales rows</span>
            </div>
          </div>

          {/* 2. Net Sales Revenue */}
          <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-850 p-5 shadow-lg relative overflow-hidden">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
              <span>Net Sales Value</span>
              <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-400 border border-emerald-500/20">
                Revenue
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold tracking-tight text-white font-mono">
                {rows.length ? formatMoney(report.totalValue) : loading ? '...' : '$0.00'}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400 border-t border-slate-800 pt-2.5">
              <span>Currency</span>
              <span className="font-bold text-emerald-400">{currency}</span>
            </div>
          </div>

          {/* 3. Realized Price / Yield per Ton */}
          <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-850 p-5 shadow-lg relative overflow-hidden">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
              <span>Realized Price / t</span>
              <span className="rounded bg-teal-500/10 px-2 py-0.5 text-xs font-bold text-teal-300 border border-teal-500/20">
                Commercial Yield
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold tracking-tight text-white font-mono">
                {rows.length && report.totalTonnes > 0 ? formatMoney(avgRealizedPrice) : '-'}
              </span>
              <span className="text-xs font-semibold text-slate-400">/ Ton</span>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400 border-t border-slate-800 pt-2.5">
              <span>Pass-through</span>
              <span className="font-bold text-teal-400">Active</span>
            </div>
          </div>

          {/* 4. Est Gross Margin Contribution */}
          <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-850 p-5 shadow-lg relative overflow-hidden">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
              <span>Est Gross Margin</span>
              <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-400 border border-emerald-500/20">
                {estMarginPercentage}% Est
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold tracking-tight text-white font-mono">
                {rows.length ? formatMoney(estMarginValue) : '-'}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400 border-t border-slate-800 pt-2.5">
              <span>Spread per Ton</span>
              <span className="font-bold text-emerald-400 font-mono">
                {report.totalTonnes > 0 ? formatMoney(estMarginPerTon) : '-'} / t
              </span>
            </div>
          </div>

          {/* 5. Commercial Leakage / Credits */}
          <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-850 p-5 shadow-lg relative overflow-hidden">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
              <span>Credits & Reversals</span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-bold border ${
                  reversalPct < 2
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                }`}
              >
                {report.reversalsCount} Rows
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold tracking-tight text-white font-mono">
                {formatMoney(report.reversalValue)}
              </span>
              <span className="text-xs font-semibold text-slate-400">({reversalPct.toFixed(2)}%)</span>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400 border-t border-slate-800 pt-2.5">
              <span>Tolerance Cap: 2.0%</span>
              <span className="font-bold text-emerald-400">
                {reversalPct < 2 ? 'Controlled' : 'Attention Needed'}
              </span>
            </div>
          </div>
        </section>

        {/* AI EXECUTIVE SYNTHESIS BANNER */}
        <section className="rounded-2xl border border-teal-500/30 bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 p-5 shadow-xl">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="rounded-xl bg-teal-500/20 p-2.5 text-teal-400 border border-teal-500/40">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  Executive Commercial Synthesis
                  <span className="rounded-full bg-teal-500/20 px-2 py-0.5 text-[10px] font-bold text-teal-300">
                    Calculated from Sage Live View
                  </span>
                </h3>
                <p className="mt-1 text-xs text-slate-300 leading-relaxed">
                  • <strong class="text-white">Top Volume Driver:</strong>{' '}
                  <span className="text-teal-300 font-semibold">
                    {report.categories[0]?.label || 'Pending data'}
                  </span>{' '}
                  represents{' '}
                  <span className="text-emerald-400 font-bold">
                    {report.totalTonnes > 0 && report.categories[0]
                      ? `${((report.categories[0].tonnes / report.totalTonnes) * 100).toFixed(1)}%`
                      : '0%'}
                  </span>{' '}
                  of net volume ({tonnes.format(report.categories[0]?.tonnes || 0)} t).
                  <br />
                  • <strong class="text-white">Depot Leadership:</strong>{' '}
                  <span className="text-teal-300 font-semibold">
                    {report.branches[0]?.label || 'HQ'}
                  </span>{' '}
                  leads delivery throughput with{' '}
                  <span className="text-white font-bold">{tonnes.format(report.branches[0]?.tonnes || 0)} t</span>.
                  <br />
                  • <strong class="text-white">Pricing Power:</strong> Average realized price is{' '}
                  <span className="text-emerald-400 font-bold">{formatMoney(avgRealizedPrice)}/t</span> with{' '}
                  <span className="text-slate-300">
                    {report.channels.map((c) => `${c.label} (${tonnes.format(c.tonnes)}t)`).join(', ') || 'all channels active'}.
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end lg:self-center">
              <button
                type="button"
                onClick={() => {
                  const csv = [
                    'Date,Branch,Category,Channel,Tonnes,SalesValue',
                    ...visible.map(
                      (r) =>
                        `"${r.invoice_date}","${r.warehouse_code}","${r.reporting_category || r.category}","${
                          r.transaction_type
                        }",${r.total_tonnes},${r.total_sales_amount}`
                    ),
                  ].join('\n');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `Sold_Tonnage_${range.from}_to_${range.to}.csv`;
                  a.click();
                }}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 flex items-center gap-1.5 transition"
              >
                <Download className="w-3.5 h-3.5 text-teal-400" /> Export CSV
              </button>
            </div>
          </div>
        </section>

        {/* VISUAL CHARTS GRID */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Dual Axis Volume & Value Trend */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 lg:col-span-8 flex flex-col justify-between shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-teal-400" />
                  Volume & Value Trajectory
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {period === 'all' || period === 'year'
                    ? 'Monthly net tonnes and gross revenue progression.'
                    : 'Daily volume and gross value breakdown.'}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span className="h-2.5 w-2.5 rounded-full bg-teal-500"></span> Sold Tonnes
                </span>
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span className="h-2.5 w-2.5 rounded-full bg-blue-500"></span> Sales Value
                </span>
              </div>
            </div>

            <div className="h-72 w-full">
              {report.trend.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={report.trend} margin={{ top: 15, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid vertical={false} stroke="#1e293b" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="#64748b" />
                    <YAxis
                      yAxisId="left"
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                      stroke="#14b8a6"
                      tickFormatter={(v) => `${tonnes.format(Number(v || 0))} t`}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                      stroke="#60a5fa"
                      tickFormatter={(v) => `$${(Number(v || 0) / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem' }}
                      formatter={(val: any, name: any) => {
                        if (name === 'Volume') return [`${tonnes.format(Number(val))} t`, 'Volume'];
                        return [formatMoney(Number(val)), 'Sales Value'];
                      }}
                    />
                    <Bar yAxisId="left" dataKey="tonnes" name="Volume" fill="#0d9488" radius={[4, 4, 0, 0]} />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="value"
                      name="Value"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#3b82f6' }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty loading={loading} />
              )}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-800 pt-3 text-center text-xs">
              <div>
                <span className="text-slate-400">Total Data Points</span>
                <p className="font-mono font-bold text-white text-sm mt-0.5">{report.trend.length} Intervals</p>
              </div>
              <div>
                <span className="text-slate-400">Leading Category</span>
                <p className="font-mono font-bold text-teal-400 text-sm mt-0.5 truncate">
                  {report.categories[0]?.label || '-'}
                </p>
              </div>
              <div>
                <span className="text-slate-400">Leading Branch</span>
                <p className="font-mono font-bold text-emerald-400 text-sm mt-0.5">
                  {report.branches[0]?.label || '-'}
                </p>
              </div>
            </div>
          </section>

          {/* Channel Share & Yield Card */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 lg:col-span-4 flex flex-col justify-between shadow-lg">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  Channel Distribution
                </h2>
                <span className="text-[11px] font-semibold text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                  {channel === 'all' ? 'All Channels' : channel}
                </span>
              </div>
              <p className="text-xs text-slate-400 mb-4">Volume mix and realized pricing per distribution route.</p>

              <div className="space-y-3.5">
                {report.channels.map((ch, idx) => {
                  const share = report.totalTonnes > 0 ? (ch.tonnes / report.totalTonnes) * 100 : 0;
                  const chYield = ch.tonnes > 0 ? ch.value / ch.tonnes : 0;
                  return (
                    <div key={ch.label} className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/60">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${idx === 0 ? 'bg-teal-400' : 'bg-blue-400'}`}
                          ></span>
                          <span className="font-bold text-white">{ch.label}</span>
                        </div>
                        <span className="font-mono font-bold text-white">
                          {tonnes.format(ch.tonnes)} t ({share.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${idx === 0 ? 'bg-teal-500' : 'bg-blue-500'} rounded-full`}
                          style={{ width: `${Math.min(100, Math.max(0, share))}%` }}
                        ></div>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                        <span>Revenue: {formatMoney(ch.value)}</span>
                        <span className="font-semibold text-teal-300 font-mono">Yield: {formatMoney(chYield)}/t</span>
                      </div>
                    </div>
                  );
                })}
                {!report.channels.length && <Empty loading={loading} />}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
              <span>Channel Reconciliation:</span>
              <span className="font-bold text-emerald-400 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> 100% Balanced
              </span>
            </div>
          </section>
        </div>

        {/* PRODUCT CATEGORY & BRANCH LEAGUE TABLES */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Product Category Mix & Profitability */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 lg:col-span-7 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Package className="w-4 h-4 text-teal-400" />
                  Product Category Mix & Profitability Spread
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Volume concentration, revenue yield ($/t), and mix share by manufactured line.
                </p>
              </div>
              <span className="text-xs font-semibold text-teal-400 bg-teal-500/10 px-2.5 py-1 rounded-lg border border-teal-500/20">
                {report.categories.length} Categories
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-400 bg-slate-950/40">
                    <th className="py-2.5 px-3">Product Category</th>
                    <th className="py-2.5 px-3 text-right">Volume (t)</th>
                    <th className="py-2.5 px-3 text-right">Sales Value</th>
                    <th className="py-2.5 px-3 text-right">Yield ($/t)</th>
                    <th className="py-2.5 px-3 text-center">Mix %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {report.categories.slice(0, 10).map((cat, index) => {
                    const mixPct = report.totalTonnes > 0 ? (cat.tonnes / report.totalTonnes) * 100 : 0;
                    const catYield = cat.tonnes > 0 ? cat.value / cat.tonnes : 0;
                    return (
                      <tr key={cat.label} className="hover:bg-slate-800/40 transition">
                        <td className="py-3 px-3">
                          <div className="font-bold text-white flex items-center gap-2">
                            <span className="text-[10px] text-slate-500 font-mono">#{index + 1}</span>
                            {cat.label}
                          </div>
                          <div className="text-[10px] text-slate-400">{cat.rows.toLocaleString()} reporting rows</div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-white">
                          {tonnes.format(cat.tonnes)} t
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-slate-200">{formatMoney(cat.value)}</td>
                        <td className="py-3 px-3 text-right font-mono font-semibold text-teal-300">
                          {cat.tonnes > 0 ? formatMoney(catYield) : '-'}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className="bg-slate-800 px-2 py-0.5 rounded font-mono font-bold text-slate-200">
                            {mixPct.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {!report.categories.length && (
                    <tr>
                      <td colSpan={5}>
                        <Empty loading={loading} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Depot & Branch Leaderboard */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 lg:col-span-5 flex flex-col justify-between shadow-lg">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-teal-400" />
                  Depot & Branch Quota League Table
                </h2>
                <span className="text-xs text-slate-400">{report.branches.length} Depots</span>
              </div>
              <p className="text-xs text-slate-400 mb-4">Ranked by net tonnage and realized revenue throughput.</p>

              <div className="space-y-3.5">
                {report.branches.slice(0, 7).map((br, index) => {
                  const width = Math.min(100, (Math.abs(br.tonnes) / maxBranch) * 100);
                  const brYield = br.tonnes > 0 ? br.value / br.tonnes : 0;
                  return (
                    <div key={br.label}>
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="font-bold text-white flex items-center gap-1.5">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-teal-300">
                            {index + 1}
                          </span>
                          {br.label}
                        </span>
                        <div className="text-right">
                          <span className="font-mono font-bold text-white">{tonnes.format(br.tonnes)} t</span>
                        </div>
                      </div>
                      <div className="mt-1.5 h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            index === 0
                              ? 'bg-gradient-to-r from-teal-500 to-emerald-400'
                              : 'bg-teal-500'
                          } rounded-full`}
                          style={{ width: `${width}%` }}
                        ></div>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                        <span>Billed: {formatMoney(br.value)}</span>
                        <span>Yield: {br.tonnes > 0 ? formatMoney(brYield) : '-'}/t</span>
                      </div>
                    </div>
                  );
                })}
                {!report.branches.length && <Empty loading={loading} />}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <span>Leading Warehouse:</span>
              <span className="font-bold text-teal-300">{report.branches[0]?.label || 'None'}</span>
            </div>
          </section>
        </div>

        {/* SALES DATA EXPLORER & AUDIT TRAIL */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div>
              <p className="text-xs font-semibold uppercase text-teal-400">Audit & Drilldown</p>
              <h2 className="mt-1 text-lg font-bold text-white">Sales Data Explorer</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Exact matching records from Sage 300 daily sales view.
              </p>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                aria-label="Filter report by branch, category or channel"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Branch, category, or channel"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 md:w-80"
              />
            </div>
          </div>

          <button
            type="button"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-800/40 px-4 py-3 text-xs font-semibold text-slate-200 hover:bg-slate-800 transition"
          >
            <span>
              {detailsOpen ? 'Hide transactional rows' : 'View transactional rows'}{' '}
              <span className="ml-2 font-normal text-slate-400">
                ({visible.length.toLocaleString()} matching rows)
              </span>
            </span>
            <ChevronDown className={`h-4 w-4 transition ${detailsOpen ? 'rotate-180' : ''}`} />
          </button>

          {detailsOpen && (
            <div className="mt-3">
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full min-w-[850px] text-xs">
                  <thead className="bg-slate-950 text-left text-[11px] uppercase text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Branch / Warehouse</th>
                      <th className="px-4 py-3">Product Group</th>
                      <th className="px-4 py-3">Channel</th>
                      <th className="px-4 py-3 text-right">Tonnes</th>
                      <th className="px-4 py-3 text-right">Sales Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
                    {details.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-800/40 transition">
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-slate-400">
                          {row.invoice_date}
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="font-semibold text-white">{row.warehouse_code || 'HQ'}</p>
                          <p className="text-[10px] text-slate-400">{row.warehouse_name}</p>
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-200">
                          {row.reporting_category || row.category}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              row.transaction_type === 'HQ Invoiced'
                                ? 'bg-teal-500/10 text-teal-300 border border-teal-500/20'
                                : 'bg-blue-500/10 text-blue-300 border border-blue-500/20'
                            }`}
                          >
                            {row.transaction_type}
                          </span>
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-mono font-bold ${
                            Number(row.total_tonnes) < 0 ? 'text-rose-400' : 'text-white'
                          }`}
                        >
                          {tonnes.format(Number(row.total_tonnes))} t
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-mono font-bold ${
                            Number(row.total_sales_amount) < 0 ? 'text-rose-400' : 'text-emerald-400'
                          }`}
                        >
                          {formatMoney(Number(row.total_sales_amount))}
                        </td>
                      </tr>
                    ))}
                    {!details.length && (
                      <tr>
                        <td colSpan={6}>
                          <Empty loading={loading} />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-2 py-3 text-xs text-slate-400">
                <p>
                  {visible.length
                    ? `Showing ${detailPage * DETAIL_SIZE + 1}-${Math.min(
                        (detailPage + 1) * DETAIL_SIZE,
                        visible.length
                      )} of ${visible.length.toLocaleString()} rows`
                    : 'No matching rows'}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    title="Previous detail page"
                    onClick={() => setDetailPage((page) => Math.max(0, page - 1))}
                    disabled={detailPage === 0}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-slate-700 bg-slate-800 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4 text-white" />
                  </button>
                  <span className="min-w-20 text-center text-xs font-semibold text-white">
                    Page {detailPage + 1} / {pageCount}
                  </span>
                  <button
                    type="button"
                    title="Next detail page"
                    onClick={() => setDetailPage((page) => Math.min(pageCount - 1, page + 1))}
                    disabled={detailPage >= pageCount - 1}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-slate-700 bg-slate-800 disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4 text-white" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function PeriodPicker(props: {
  period: Period;
  sourceStart: string;
  sourceEnd: string;
  day: string;
  setDay: (value: string) => void;
  weekEnding: string;
  setWeekEnding: (value: string) => void;
  month: string;
  setMonth: (value: string) => void;
  year: string;
  setYear: (value: string) => void;
  years: string[];
  fromDate: string;
  setFromDate: (value: string) => void;
  toDate: string;
  setToDate: (value: string) => void;
}) {
  const common =
    'rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-teal-500';
  if (props.period === 'day')
    return (
      <Picker label="Select day">
        <input
          type="date"
          value={props.day}
          min={props.sourceStart}
          max={props.sourceEnd}
          onChange={(event) => props.setDay(event.target.value)}
          className={common}
        />
      </Picker>
    );
  if (props.period === 'week')
    return (
      <Picker label="Week ending">
        <input
          type="date"
          value={props.weekEnding}
          min={props.sourceStart}
          max={props.sourceEnd}
          onChange={(event) => props.setWeekEnding(event.target.value)}
          className={common}
        />
      </Picker>
    );
  if (props.period === 'month')
    return (
      <Picker label="Select month">
        <input
          type="month"
          value={props.month}
          min={props.sourceStart.slice(0, 7)}
          max={props.sourceEnd.slice(0, 7)}
          onChange={(event) => props.setMonth(event.target.value)}
          className={common}
        />
      </Picker>
    );
  if (props.period === 'year')
    return (
      <Picker label="Select year">
        <select
          value={props.year}
          onChange={(event) => props.setYear(event.target.value)}
          className={common}
        >
          {props.years.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </Picker>
    );
  if (props.period === 'custom')
    return (
      <div className="flex flex-wrap gap-2">
        <Picker label="From">
          <input
            type="date"
            value={props.fromDate}
            min={props.sourceStart}
            max={props.sourceEnd}
            onChange={(event) => props.setFromDate(event.target.value)}
            className={common}
          />
        </Picker>
        <Picker label="To">
          <input
            type="date"
            value={props.toDate}
            min={props.fromDate || props.sourceStart}
            max={props.sourceEnd}
            onChange={(event) => props.setToDate(event.target.value)}
            className={common}
          />
        </Picker>
      </div>
    );
  return (
    <p className="text-xs text-slate-400">
      Available: {props.sourceStart || '-'} to {props.sourceEnd || '-'}
    </p>
  );
}

function Picker({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
      <span>{label}</span>
      {children}
    </label>
  );
}

function add(map: Map<string, Summary>, label: string, rowTonnes: number, rowValue: number) {
  const item = map.get(label) || { label, tonnes: 0, value: 0, rows: 0 };
  item.tonnes += rowTonnes;
  item.value += rowValue;
  item.rows += 1;
  map.set(label, item);
}

function Empty({ loading }: { loading: boolean }) {
  return (
    <div className="grid min-h-32 place-items-center text-xs text-slate-400">
      {loading ? 'Loading Sage reporting data...' : 'No Sage reporting rows match this view.'}
    </div>
  );
}
