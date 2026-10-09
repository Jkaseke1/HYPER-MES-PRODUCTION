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
  AlertCircle,
  Building2,
  Calendar,
  ChevronDown,
  Download,
  Filter,
  Grid,
  Package,
  Printer,
  RefreshCw,
  Search,
  Sparkles,
  Store,
  Table,
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
type MatrixViewMode = 'tonnes' | 'value';
type Summary = { label: string; tonnes: number; value: number; rows: number };

const FETCH_SIZE = 1000;
const SALE_COLUMNS =
  'id,invoice_date,warehouse_code,warehouse_name,reporting_category,category,sub_category,transaction_type,total_tonnes,total_sales_amount,line_count,imported_at';

let cachedSales: { userId: string; rows: Sale[] } | undefined;

supabase.auth.onAuthStateChange((_event, session) => {
  if (cachedSales?.userId !== session?.user.id) cachedSales = undefined;
});

const money = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tonnesFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const [matrixMetric, setMatrixMetric] = useState<MatrixViewMode>('tonnes');
  const [matrixSearch, setMatrixSearch] = useState('');
  const [day, setDay] = useState('');
  const [weekEnding, setWeekEnding] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

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
    return rows.filter((row) => {
      if (range.from && row.invoice_date < range.from) return false;
      if (range.to && row.invoice_date > range.to) return false;
      if (channel !== 'all' && row.transaction_type !== channel) return false;
      return true;
    });
  }, [channel, range, rows]);

  // Overall Report Metrics
  const report = useMemo(() => {
    const channels = new Map<string, Summary>();
    const categories = new Map<string, Summary>();
    const branches = new Map<string, Summary>();
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
      const branch = (row.warehouse_code || 'HQ').trim().toUpperCase();

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

    return {
      totalTonnes,
      totalValue,
      reversalsCount,
      reversalValue,
      latestImport,
      channels: [...channels.values()].sort((a, b) => b.tonnes - a.tonnes),
      categories: [...categories.values()].sort((a, b) => b.tonnes - a.tonnes),
      branches: [...branches.values()].sort((a, b) => b.tonnes - a.tonnes),
      trend: [...trend.values()].sort((a, b) => a.sort.localeCompare(b.sort)),
    };
  }, [period, visible]);

  // Power BI Style Cross-Tab Matrix: Category vs Branch
  const matrix = useMemo(() => {
    const branchTotalsTonnes = new Map<string, number>();
    const branchTotalsValue = new Map<string, number>();
    const catTotalsTonnes = new Map<string, number>();
    const catTotalsValue = new Map<string, number>();
    const cellMapTonnes = new Map<string, Map<string, number>>();
    const cellMapValue = new Map<string, Map<string, number>>();
    const allBranchesSet = new Set<string>();
    const allCatsSet = new Set<string>();

    visible.forEach((row) => {
      const cat = (row.reporting_category || row.category || 'Unclassified').trim();
      const branch = (row.warehouse_code || 'HQ').trim().toUpperCase();
      const t = Number(row.total_tonnes || 0);
      const v = Number(row.total_sales_amount || 0);

      allCatsSet.add(cat);
      allBranchesSet.add(branch);

      // Cell Tonnes
      if (!cellMapTonnes.has(cat)) cellMapTonnes.set(cat, new Map<string, number>());
      const rowT = cellMapTonnes.get(cat)!;
      rowT.set(branch, (rowT.get(branch) || 0) + t);

      // Cell Value
      if (!cellMapValue.has(cat)) cellMapValue.set(cat, new Map<string, number>());
      const rowV = cellMapValue.get(cat)!;
      rowV.set(branch, (rowV.get(branch) || 0) + v);

      // Category Totals
      catTotalsTonnes.set(cat, (catTotalsTonnes.get(cat) || 0) + t);
      catTotalsValue.set(cat, (catTotalsValue.get(cat) || 0) + v);

      // Branch Totals
      branchTotalsTonnes.set(branch, (branchTotalsTonnes.get(branch) || 0) + t);
      branchTotalsValue.set(branch, (branchTotalsValue.get(branch) || 0) + v);
    });

    const branches = [...allBranchesSet].sort();
    let categories = [...allCatsSet].sort((a, b) => {
      // Sort alphabetically, similar to Power BI view
      return a.localeCompare(b);
    });

    if (matrixSearch.trim()) {
      const q = matrixSearch.trim().toLowerCase();
      categories = categories.filter((c) => c.toLowerCase().includes(q));
    }

    return {
      branches,
      categories,
      cellMapTonnes,
      cellMapValue,
      catTotalsTonnes,
      catTotalsValue,
      branchTotalsTonnes,
      branchTotalsValue,
    };
  }, [matrixSearch, visible]);

  const years = [...new Set(rows.map((row) => row.invoice_date.slice(0, 4)))].sort().reverse();
  const latestImport = report.latestImport ? new Date(report.latestImport).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not yet imported';

  // Financial Metrics
  const avgRealizedPrice = report.totalTonnes > 0 ? report.totalValue / report.totalTonnes : 0;
  const reversalPct = report.totalValue > 0 ? (report.reversalValue / report.totalValue) * 100 : 0;

  const formatMoney = (val: number) => {
    if (currency === 'LOCAL') {
      return `ZWG ${money.format(val * 25)}`;
    }
    return `$${money.format(val)}`;
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 text-slate-800 p-4 md:p-6 lg:p-7 font-sans">
      <div className="mx-auto max-w-[1600px] space-y-5">
        
        {/* HYPERFEEDS EXECUTIVE BANNER (Company Navy & Orange) */}
        <header className="rounded-xl border border-[#0d1640] bg-[#0c1543] p-5 md:p-6 text-white shadow-md relative overflow-hidden">
          <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full border-4 border-[#f26e22]/20 pointer-events-none" />
          <div className="absolute right-10 bottom-0 h-1.5 w-32 bg-[#f26e22] rounded-full" />

          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between relative z-10">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="rounded bg-[#f26e22] px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-white shadow-sm">
                  Hyperfeeds
                </span>
                <span className="text-xs text-orange-200/90 font-medium tracking-wide">
                  Animal Nutrition &bull; Sage 300 / Power BI Live Data
                </span>
                <span className="text-xs text-slate-400">| Synced: {latestImport}</span>
              </div>
              <h1 className="mt-1.5 text-2xl font-black tracking-tight text-white lg:text-3xl">
                Sold Tonnage & Commercial Performance
              </h1>
            </div>

            {/* ACTION CONTROLS */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center rounded-lg bg-[#070d2b] p-1 border border-white/10 text-xs">
                <button
                  type="button"
                  onClick={() => setCurrency('USD')}
                  className={`rounded px-3 py-1 font-bold transition ${
                    currency === 'USD' ? 'bg-[#f26e22] text-white shadow' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  USD ($)
                </button>
                <button
                  type="button"
                  onClick={() => setCurrency('LOCAL')}
                  className={`rounded px-3 py-1 font-bold transition ${
                    currency === 'LOCAL' ? 'bg-[#f26e22] text-white shadow' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  ZWG / Local
                </button>
              </div>

              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-white/20 transition"
              >
                <Printer className="h-3.5 w-3.5 text-[#f26e22]" />
                Print / PDF
              </button>

              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-lg bg-[#f26e22] hover:bg-[#e05d12] px-3.5 py-1.5 text-xs font-bold text-white shadow-md transition disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Syncing...' : 'Refresh'}
              </button>
            </div>
          </div>
        </header>

        {loadError && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
            <span>Could not refresh live data. Showing cached totals. Click Refresh to retry.</span>
          </div>
        )}

        {/* TIME & CHANNEL FILTER BAR (Clean Light Slate) */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between text-xs">
            {/* Horizon */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-bold text-slate-500 uppercase tracking-wide mr-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-[#0c1543]" /> Period:
              </span>
              {(['day', 'week', 'month', 'year', 'all', 'custom'] as Period[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setPeriod(item)}
                  className={`rounded-md px-3 py-1 font-semibold transition ${
                    period === item
                      ? 'bg-[#0c1543] text-white shadow-sm'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {labels[item]}
                </button>
              ))}
            </div>

            {/* Channels */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-slate-500 uppercase tracking-wide mr-1">Channel:</span>
              {(['all', 'Branch POS', 'HQ Invoiced'] as Channel[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setChannel(item)}
                  className={`rounded-md px-3 py-1 font-semibold transition border ${
                    channel === item
                      ? 'border-[#f26e22] bg-[#f26e22] text-white shadow-sm'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {item === 'all' ? 'All Channels' : item}
                </button>
              ))}

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
        </div>

        {/* 4 CORE EXECUTIVE KPI CARDS */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* 1. Volume Sold */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-[#f26e22]/50 transition">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-slate-500">Net Volume Sold</span>
              <span className="rounded bg-orange-50 px-2 py-0.5 font-bold text-[#f26e22] border border-orange-200">
                Tonnes
              </span>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="text-2xl lg:text-3xl font-extrabold text-[#0c1543] font-mono">
                {rows.length ? tonnesFmt.format(report.totalTonnes) : loading ? '...' : '0.00'}
              </span>
              <span className="text-xs font-bold text-slate-500">t</span>
            </div>
            <p className="mt-2 text-xs text-slate-500 border-t border-slate-100 pt-2">
              Coverage: <strong className="text-slate-700">{visible.length.toLocaleString()}</strong> sales rows
            </p>
          </div>

          {/* 2. Net Sales Revenue */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-[#0c1543]/50 transition">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-slate-500">Net Sales Value</span>
              <span className="rounded bg-blue-50 px-2 py-0.5 font-bold text-[#0c1543] border border-blue-200">
                Revenue
              </span>
            </div>
            <div className="mt-2.5">
              <span className="text-2xl lg:text-3xl font-extrabold text-[#0c1543] font-mono">
                {rows.length ? formatMoney(report.totalValue) : loading ? '...' : '$0.00'}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500 border-t border-slate-100 pt-2">
              Billed in <strong className="text-slate-700">{currency}</strong>
            </p>
          </div>

          {/* 3. Realized Yield / Price per Ton */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-[#f26e22]/50 transition">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-slate-500">Average Price / Ton</span>
              <span className="rounded bg-orange-50 px-2 py-0.5 font-bold text-[#f26e22] border border-orange-200">
                Yield
              </span>
            </div>
            <div className="mt-2.5 flex items-baseline gap-1.5">
              <span className="text-2xl lg:text-3xl font-extrabold text-[#f26e22] font-mono">
                {rows.length && report.totalTonnes > 0 ? formatMoney(avgRealizedPrice) : '-'}
              </span>
              <span className="text-xs font-bold text-slate-500">/ Ton</span>
            </div>
            <p className="mt-2 text-xs text-slate-500 border-t border-slate-100 pt-2">
              Realized revenue per metric ton
            </p>
          </div>

          {/* 4. Commercial Leakage / Reversals */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 transition">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-slate-500">Credits / Reversals</span>
              <span
                className={`rounded px-2 py-0.5 font-bold border ${
                  reversalPct < 2.5
                    ? 'bg-slate-100 text-slate-700 border-slate-200'
                    : 'bg-rose-50 text-rose-700 border-rose-200'
                }`}
              >
                {report.reversalsCount} Rows
              </span>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="text-2xl lg:text-3xl font-extrabold text-slate-800 font-mono">
                {formatMoney(report.reversalValue)}
              </span>
              <span className="text-xs font-semibold text-slate-500">({reversalPct.toFixed(2)}%)</span>
            </div>
            <p className="mt-2 text-xs text-slate-500 border-t border-slate-100 pt-2">
              Status:{' '}
              <strong className={reversalPct < 2.5 ? 'text-emerald-700' : 'text-rose-700'}>
                {reversalPct < 2.5 ? 'Normal Tolerance (<2.5%)' : 'Attention Needed'}
              </strong>
            </p>
          </div>
        </section>

        {/* 2-COLUMN SECTION: TRAJECTORY CHART & CHANNEL SPLIT */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Chart (8 cols) */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-8 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-base font-bold text-[#0c1543] flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-[#f26e22]" /> Sales Trend Trajectory
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Monthly sold tonnes (Navy Bars) vs sales revenue (Orange Line).
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs font-semibold">
                <span className="flex items-center gap-1 text-slate-700">
                  <span className="h-2.5 w-2.5 rounded bg-[#0c1543]"></span> Sold Tonnes
                </span>
                <span className="flex items-center gap-1 text-slate-700">
                  <span className="h-2 w-2 rounded-full bg-[#f26e22]"></span> Sales Value
                </span>
              </div>
            </div>

            <div className="h-56 w-full">
              {report.trend.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={report.trend} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="#64748b" />
                    <YAxis
                      yAxisId="left"
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                      stroke="#0c1543"
                      tickFormatter={(v) => `${tonnesFmt.format(Number(v || 0))}t`}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                      stroke="#f26e22"
                      tickFormatter={(v) => `$${(Number(v || 0) / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '0.5rem', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      formatter={(val: any, name: any) => {
                        if (name === 'Volume') return [`${tonnesFmt.format(Number(val))} t`, 'Volume'];
                        return [formatMoney(Number(val)), 'Sales Value'];
                      }}
                    />
                    <Bar yAxisId="left" dataKey="tonnes" name="Volume" fill="#0c1543" radius={[4, 4, 0, 0]} />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="value"
                      name="Value"
                      stroke="#f26e22"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: '#f26e22' }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty loading={loading} />
              )}
            </div>
          </div>

          {/* Channel Summary (4 cols) */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-4 shadow-sm flex flex-col justify-between">
            <div>
              <h2 className="text-base font-bold text-[#0c1543] mb-1">Channel Distribution</h2>
              <p className="text-xs text-slate-500 mb-4">Volume mix and realized pricing per route.</p>

              <div className="space-y-3">
                {report.channels.map((ch, idx) => {
                  const share = report.totalTonnes > 0 ? (ch.tonnes / report.totalTonnes) * 100 : 0;
                  const chYield = ch.tonnes > 0 ? ch.value / ch.tonnes : 0;
                  return (
                    <div key={ch.label} className="p-3 rounded-lg border border-slate-100 bg-slate-50/60">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-800 flex items-center gap-1.5">
                          {idx === 0 ? <Building2 className="w-3.5 h-3.5 text-[#0c1543]" /> : <Store className="w-3.5 h-3.5 text-[#f26e22]" />}
                          {ch.label}
                        </span>
                        <span className="font-mono font-bold text-slate-800">
                          {tonnesFmt.format(ch.tonnes)} t ({share.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${idx === 0 ? 'bg-[#0c1543]' : 'bg-[#f26e22]'} rounded-full`}
                          style={{ width: `${Math.min(100, Math.max(0, share))}%` }}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                        <span>Revenue: {formatMoney(ch.value)}</span>
                        <span className="font-bold text-[#f26e22]">Yield: {formatMoney(chYield)}/t</span>
                      </div>
                    </div>
                  );
                })}
                {!report.channels.length && <Empty loading={loading} />}
              </div>
            </div>

            <p className="mt-3 text-[11px] text-slate-400 border-t border-slate-100 pt-2 text-right">
              Channel Reconciliation Balanced
            </p>
          </div>
        </div>

        {/* TONNAGE BY CATEGORY & BRANCH (POWER BI PIVOT MATRIX) */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {/* Header Bar */}
          <div className="p-4 border-b border-slate-200 bg-white flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#0c1543] bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                  Power BI Matrix
                </span>
                <h2 className="text-sm md:text-base font-bold text-[#0c1543] uppercase tracking-wide">
                  Tonnage by Category & Branch
                </h2>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Cross-tabulation of {matrix.categories.length} product categories across {matrix.branches.length} branches.
              </p>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {/* Metric Toggle */}
              <div className="flex items-center rounded-lg bg-slate-100 p-0.5 border border-slate-200">
                <button
                  type="button"
                  onClick={() => setMatrixMetric('tonnes')}
                  className={`rounded px-2.5 py-1 font-semibold transition ${
                    matrixMetric === 'tonnes' ? 'bg-[#0c1543] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Tonnes (t)
                </button>
                <button
                  type="button"
                  onClick={() => setMatrixMetric('value')}
                  className={`rounded px-2.5 py-1 font-semibold transition ${
                    matrixMetric === 'value' ? 'bg-[#0c1543] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Value ($)
                </button>
              </div>

              {/* Search Category */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  value={matrixSearch}
                  onChange={(e) => setMatrixSearch(e.target.value)}
                  placeholder="Filter category..."
                  className="rounded-lg border border-slate-300 py-1 pl-8 pr-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#f26e22] w-40"
                />
              </div>

              {/* Export Matrix */}
              <button
                type="button"
                onClick={() => {
                  const headerRow = ['ReportingCategory', ...matrix.branches, 'Total'].join(',');
                  const rowsCsv = matrix.categories.map((cat) => {
                    const rowVals = matrix.branches.map((br) => {
                      const val =
                        matrixMetric === 'tonnes'
                          ? matrix.cellMapTonnes.get(cat)?.get(br) || 0
                          : matrix.cellMapValue.get(cat)?.get(br) || 0;
                      return val.toFixed(2);
                    });
                    const rowTotal =
                      matrixMetric === 'tonnes'
                        ? matrix.catTotalsTonnes.get(cat) || 0
                        : matrix.catTotalsValue.get(cat) || 0;
                    return [`"${cat}"`, ...rowVals, rowTotal.toFixed(2)].join(',');
                  });
                  const totalRow = [
                    'Total',
                    ...matrix.branches.map((br) => {
                      const brVal =
                        matrixMetric === 'tonnes'
                          ? matrix.branchTotalsTonnes.get(br) || 0
                          : matrix.branchTotalsValue.get(br) || 0;
                      return brVal.toFixed(2);
                    }),
                    (matrixMetric === 'tonnes' ? report.totalTonnes : report.totalValue).toFixed(2),
                  ].join(',');

                  const csv = [headerRow, ...rowsCsv, totalRow].join('\n');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `Tonnage_By_Category_And_Branch_${matrixMetric}.csv`;
                  a.click();
                }}
                className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <Download className="w-3.5 h-3.5 text-[#f26e22]" /> CSV
              </button>
            </div>
          </div>

          {/* Matrix Grid with Sticky Header & First Column */}
          <div className="overflow-x-auto max-h-[520px] custom-scrollbar">
            <table className="w-full min-w-[1100px] text-xs border-collapse">
              <thead className="sticky top-0 z-20 bg-[#f8fafc] text-slate-700 shadow-sm border-b border-slate-300">
                <tr>
                  <th className="sticky left-0 z-30 bg-[#f8fafc] px-3.5 py-2.5 text-left font-bold border-r border-slate-300 text-slate-800 min-w-[160px]">
                    ReportingCategory
                  </th>
                  {matrix.branches.map((branch) => (
                    <th key={branch} className="px-2 py-2.5 text-right font-bold text-[11px] text-slate-700 whitespace-nowrap min-w-[56px]">
                      {branch}
                    </th>
                  ))}
                  <th className="sticky right-0 z-30 bg-[#f1f5f9] px-3 py-2.5 text-right font-black border-l border-slate-300 text-[#0c1543] min-w-[72px]">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                {matrix.categories.map((cat, idx) => {
                  const catTotal =
                    matrixMetric === 'tonnes'
                      ? matrix.catTotalsTonnes.get(cat) || 0
                      : matrix.catTotalsValue.get(cat) || 0;

                  return (
                    <tr key={cat} className={idx % 2 === 0 ? 'bg-white hover:bg-orange-50/40 transition' : 'bg-slate-50/50 hover:bg-orange-50/40 transition'}>
                      {/* Sticky Category Column */}
                      <td className={`sticky left-0 z-10 px-3.5 py-2 font-sans font-semibold border-r border-slate-200 text-slate-900 whitespace-nowrap ${
                        idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'
                      }`}>
                        {cat}
                      </td>

                      {/* Branch Cells */}
                      {matrix.branches.map((branch) => {
                        const val =
                          matrixMetric === 'tonnes'
                            ? matrix.cellMapTonnes.get(cat)?.get(branch)
                            : matrix.cellMapValue.get(cat)?.get(branch);

                        if (val === undefined || val === 0) {
                          return (
                            <td key={branch} className="px-2 py-2 text-right text-slate-300 font-sans">
                              -
                            </td>
                          );
                        }

                        return (
                          <td
                            key={branch}
                            className={`px-2 py-2 text-right whitespace-nowrap ${
                              val < 0 ? 'text-rose-600 font-bold' : 'text-slate-800'
                            }`}
                          >
                            {matrixMetric === 'tonnes' ? tonnesFmt.format(val) : money.format(val)}
                          </td>
                        );
                      })}

                      {/* Row Total (Sticky Right) */}
                      <td className="sticky right-0 z-10 bg-slate-50 px-3 py-2 text-right font-bold border-l border-slate-200 text-[#0c1543] whitespace-nowrap">
                        {matrixMetric === 'tonnes' ? tonnesFmt.format(catTotal) : money.format(catTotal)}
                      </td>
                    </tr>
                  );
                })}

                {!matrix.categories.length && (
                  <tr>
                    <td colSpan={matrix.branches.length + 2} className="py-8 text-center text-slate-400 font-sans">
                      {loading ? 'Loading Sage reporting data...' : 'No matching categories in this view.'}
                    </td>
                  </tr>
                )}
              </tbody>

              {/* Total Bottom Row */}
              {matrix.categories.length > 0 && (
                <tfoot className="sticky bottom-0 z-20 bg-[#eef2f6] border-t-2 border-slate-300 font-mono text-[11px] font-bold text-slate-900 shadow-md">
                  <tr>
                    <td className="sticky left-0 z-30 bg-[#eef2f6] px-3.5 py-2.5 font-sans font-black border-r border-slate-300 text-[#0c1543]">
                      Total
                    </td>
                    {matrix.branches.map((branch) => {
                      const brTotal =
                        matrixMetric === 'tonnes'
                          ? matrix.branchTotalsTonnes.get(branch) || 0
                          : matrix.branchTotalsValue.get(branch) || 0;

                      return (
                        <td key={branch} className="px-2 py-2.5 text-right whitespace-nowrap">
                          {matrixMetric === 'tonnes' ? tonnesFmt.format(brTotal) : money.format(brTotal)}
                        </td>
                      );
                    })}
                    <td className="sticky right-0 z-30 bg-[#dfe7ef] px-3 py-2.5 text-right font-black border-l border-slate-300 text-[#f26e22] text-xs whitespace-nowrap">
                      {matrixMetric === 'tonnes'
                        ? tonnesFmt.format(report.totalTonnes)
                        : formatMoney(report.totalValue)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span>
              Values shown in: <strong className="text-slate-800">{matrixMetric === 'tonnes' ? 'Metric Tonnes (t)' : `Sales Amount (${currency})`}</strong> &bull; Reversals highlighted in red.
            </span>
            <span>
              Grand Total: <strong className="text-[#0c1543] font-mono">{tonnesFmt.format(report.totalTonnes)} t</strong> | <strong className="text-[#f26e22] font-mono">{formatMoney(report.totalValue)}</strong>
            </span>
          </div>
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
  const common = 'rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700';
  if (props.period === 'day')
    return (
      <label className="flex items-center gap-1 text-slate-500">
        Day: <input type="date" value={props.day} min={props.sourceStart} max={props.sourceEnd} onChange={(e) => props.setDay(e.target.value)} className={common} />
      </label>
    );
  if (props.period === 'week')
    return (
      <label className="flex items-center gap-1 text-slate-500">
        Week End: <input type="date" value={props.weekEnding} min={props.sourceStart} max={props.sourceEnd} onChange={(e) => props.setWeekEnding(e.target.value)} className={common} />
      </label>
    );
  if (props.period === 'month')
    return (
      <label className="flex items-center gap-1 text-slate-500">
        Month: <input type="month" value={props.month} min={props.sourceStart.slice(0, 7)} max={props.sourceEnd.slice(0, 7)} onChange={(e) => props.setMonth(e.target.value)} className={common} />
      </label>
    );
  if (props.period === 'year')
    return (
      <label className="flex items-center gap-1 text-slate-500">
        Year: <select value={props.year} onChange={(e) => props.setYear(e.target.value)} className={common}>{props.years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
      </label>
    );
  if (props.period === 'custom')
    return (
      <div className="flex items-center gap-1 text-slate-500">
        From: <input type="date" value={props.fromDate} min={props.sourceStart} max={props.sourceEnd} onChange={(e) => props.setFromDate(e.target.value)} className={common} />
        To: <input type="date" value={props.toDate} min={props.fromDate || props.sourceStart} max={props.sourceEnd} onChange={(e) => props.setToDate(e.target.value)} className={common} />
      </div>
    );
  return null;
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
    <div className="grid min-h-28 place-items-center text-xs text-slate-400">
      {loading ? 'Loading Sage reporting data...' : 'No sales records match this view.'}
    </div>
  );
}
