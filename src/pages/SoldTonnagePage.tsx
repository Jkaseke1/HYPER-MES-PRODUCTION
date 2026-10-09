import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
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
  ChevronRight,
  Download,
  Printer,
  RefreshCw,
  Search,
  Store,
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
type MatrixViewMode = 'tonnes' | 'value';
type Summary = { label: string; detail: string; tonnes: number; value: number; rows: number };

const FETCH_SIZE = 1000;
const SALE_COLUMNS =
  'id,invoice_date,warehouse_code,warehouse_name,reporting_category,category,sub_category,transaction_type,total_tonnes,total_sales_amount,line_count,imported_at';
const CHANNEL_COLORS = ['#0c1543', '#f26e22', '#1d4ed8', '#0f766e', '#7c3aed'];
const AUDIT_PAGE_SIZE = 150;

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

const daysInclusive = (from: string, to: string) => {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
};

const deltaPct = (current: number, prior: number) => {
  if (!prior) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
};

const formatMoney = (val: number) => `$${money.format(val)}`;

export default function SoldTonnagePage() {
  const [rows, setRows] = useState<Sale[]>([]);
  const [period, setPeriod] = useState<Period>('all');
  const [channel, setChannel] = useState<Channel>('all');
  const [matrixMetric, setMatrixMetric] = useState<MatrixViewMode>('tonnes');
  const [matrixSearch, setMatrixSearch] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditOpen, setAuditOpen] = useState(false);
  const [day, setDay] = useState('');
  const [weekEnding, setWeekEnding] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = async (force = false) => {
    setLoading(true);
    setLoadError(false);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) throw new Error('Please sign in to view sales reporting.');

      if (!force && cachedSales?.userId === userId && cachedSales.rows.length > 0) {
        setRows(cachedSales.rows);
        setLoading(false);
        return;
      }

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
    void load(false);
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

  const inRange = (row: Sale, from: string, to: string) => {
    if (from && row.invoice_date < from) return false;
    if (to && row.invoice_date > to) return false;
    if (channel !== 'all' && row.transaction_type !== channel) return false;
    return true;
  };

  const visible = useMemo(() => rows.filter((row) => inRange(row, range.from, range.to)), [channel, range, rows]);

  const priorVisible = useMemo(() => {
    if (period === 'all' || !range.from || !range.to) return [];
    const span = daysInclusive(range.from, range.to);
    if (span <= 0) return [];
    const priorTo = shiftDate(range.from, -1);
    const priorFrom = shiftDate(range.from, -span);
    return rows.filter((row) => inRange(row, priorFrom, priorTo));
  }, [channel, period, range.from, range.to, rows]);

  const report = useMemo(() => summarize(visible, period), [period, visible]);
  const priorReport = useMemo(() => summarize(priorVisible, period), [period, priorVisible]);

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

      if (!cellMapTonnes.has(cat)) cellMapTonnes.set(cat, new Map<string, number>());
      const rowT = cellMapTonnes.get(cat)!;
      rowT.set(branch, (rowT.get(branch) || 0) + t);

      if (!cellMapValue.has(cat)) cellMapValue.set(cat, new Map<string, number>());
      const rowV = cellMapValue.get(cat)!;
      rowV.set(branch, (rowV.get(branch) || 0) + v);

      catTotalsTonnes.set(cat, (catTotalsTonnes.get(cat) || 0) + t);
      catTotalsValue.set(cat, (catTotalsValue.get(cat) || 0) + v);
      branchTotalsTonnes.set(branch, (branchTotalsTonnes.get(branch) || 0) + t);
      branchTotalsValue.set(branch, (branchTotalsValue.get(branch) || 0) + v);
    });

    const branches = [...allBranchesSet].sort();
    let categories = [...allCatsSet].sort((a, b) => a.localeCompare(b));

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
  const latestImport = report.latestImport
    ? new Date(report.latestImport).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Not yet imported';

  const avgRealizedPrice = report.totalTonnes > 0 ? report.totalValue / report.totalTonnes : 0;
  const priorPrice = priorReport.totalTonnes > 0 ? priorReport.totalValue / priorReport.totalTonnes : 0;
  const reversalPct = report.totalValue > 0 ? (report.reversalValue / Math.abs(report.totalValue)) * 100 : 0;
  const activeDays = report.activeDays || 1;
  const dailyRate = report.totalTonnes / activeDays;
  const tonnesChange = period === 'all' ? null : deltaPct(report.totalTonnes, priorReport.totalTonnes);
  const valueChange = period === 'all' ? null : deltaPct(report.totalValue, priorReport.totalValue);
  const priceChange = period === 'all' ? null : deltaPct(avgRealizedPrice, priorPrice);

  const briefing = useMemo(() => {
    if (!visible.length) return [];
    const items: string[] = [];
    const topCat = report.categories[0];
    if (topCat) {
      const share = report.totalTonnes ? (topCat.tonnes / report.totalTonnes) * 100 : 0;
      items.push(
        `Volume mix: ${topCat.label} leads with ${tonnesFmt.format(topCat.tonnes)} t (${share.toFixed(1)}% of net tonnes).`
      );
    }
    const priced = report.categories.filter((item) => item.tonnes > 0).sort((a, b) => b.value / b.tonnes - a.value / a.tonnes);
    if (priced[0]) {
      items.push(
        `Pricing power: ${priced[0].label} has the highest realized yield at ${formatMoney(priced[0].value / priced[0].tonnes)} / t.`
      );
    }
    const topDepot = report.branches[0];
    const lagDepot = report.branches[report.branches.length - 1];
    if (topDepot && lagDepot && topDepot.label !== lagDepot.label) {
      items.push(
        `Depot spotlight: ${depotLabel(topDepot)} is the volume leader; ${depotLabel(lagDepot)} is lowest in this view.`
      );
    }
    const hq = report.channels.find((item) => item.label === 'HQ Invoiced');
    const pos = report.channels.find((item) => item.label === 'Branch POS');
    if (hq || pos) {
      const hqShare = report.totalTonnes && hq ? (hq.tonnes / report.totalTonnes) * 100 : 0;
      const posShare = report.totalTonnes && pos ? (pos.tonnes / report.totalTonnes) * 100 : 0;
      items.push(
        `Channel split: HQ Invoiced ${hqShare.toFixed(1)}% vs Branch POS ${posShare.toFixed(1)}% of net tonnes.`
      );
    }
    if (report.reversalsCount) {
      items.push(
        `Leakage: ${report.reversalsCount} credit/reversal rows total ${formatMoney(report.reversalValue)} (${reversalPct.toFixed(2)}% of net billed value).`
      );
    }
    return items.slice(0, 4);
  }, [report, reversalPct, visible.length]);

  const auditRows = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter((row) =>
      [
        row.invoice_date,
        row.warehouse_code,
        row.warehouse_name,
        row.reporting_category,
        row.category,
        row.sub_category,
        row.transaction_type,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [auditSearch, visible]);

  const exportMatrixCsv = () => {
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
        matrixMetric === 'tonnes' ? matrix.catTotalsTonnes.get(cat) || 0 : matrix.catTotalsValue.get(cat) || 0;
      return [`"${cat}"`, ...rowVals, rowTotal.toFixed(2)].join(',');
    });
    const totalRow = [
      'Total',
      ...matrix.branches.map((br) => {
        const brVal =
          matrixMetric === 'tonnes' ? matrix.branchTotalsTonnes.get(br) || 0 : matrix.branchTotalsValue.get(br) || 0;
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
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 text-slate-800 p-4 md:p-6 lg:p-7 font-sans print:bg-white print:p-0">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <header className="rounded-xl border border-[#0d1640] bg-[#0c1543] p-5 md:p-6 text-white shadow-md relative overflow-hidden">
          <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full border-4 border-[#f26e22]/20 pointer-events-none" />
          <div className="absolute right-10 bottom-0 h-1.5 w-32 bg-[#f26e22] rounded-full" />

          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between relative z-10">
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="rounded bg-[#f26e22] px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-white shadow-sm">
                  Hyperfeeds
                </span>
                <span className="text-xs text-slate-400">Synced: {latestImport}</span>
              </div>
              <h1 className="mt-1.5 text-2xl font-black tracking-tight text-white lg:text-3xl">
                Sold Tonnage
              </h1>
              <p className="mt-1 max-w-3xl text-xs text-slate-300">
                Totals are net sums of billed tonnes and billed value from the Power BI reporting view. No budgets,
                FX conversions, or margin estimates are applied.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 print:hidden">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-white/20 transition"
              >
                <Printer className="h-3.5 w-3.5 text-[#f26e22]" />
                Boardroom Brief / PDF
              </button>
              <button
                type="button"
                onClick={() => void load(true)}
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

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm print:hidden">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between text-xs">
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
                    period === item ? 'bg-[#0c1543] text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {labels[item]}
                </button>
              ))}
            </div>

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

        {briefing.length > 0 && (
          <section className="rounded-xl border border-[#0c1543]/15 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <span className="rounded bg-[#0c1543] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-white">
                10-second briefing
              </span>
              <span className="text-xs text-slate-500">Built from the filtered Power BI rows in this view only.</span>
            </div>
            <ul className="grid gap-1.5 text-sm text-slate-700 md:grid-cols-2">
              {briefing.map((item) => (
                <li key={item} className="rounded-lg bg-slate-50 px-3 py-2 border border-slate-100">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            title="Net Volume Sold"
            badge="Tonnes"
            value={rows.length ? tonnesFmt.format(report.totalTonnes) : loading ? '...' : '0.00'}
            suffix="t"
            footnote={`Coverage: ${visible.length.toLocaleString()} billed rows`}
            change={tonnesChange}
          />
          <KpiCard
            title="Net Sales Value"
            badge="As billed"
            value={rows.length ? formatMoney(report.totalValue) : loading ? '...' : '$0.00'}
            footnote="Power BI TotalSalesAmount — no FX conversion"
            change={valueChange}
          />
          <KpiCard
            title="Average Price / Ton"
            badge="Yield"
            value={rows.length && report.totalTonnes > 0 ? formatMoney(avgRealizedPrice) : '—'}
            suffix="/ t"
            footnote="Net billed value ÷ net tonnes"
            change={priceChange}
            accent
          />
          <KpiCard
            title="Daily Run-Rate"
            badge={`${report.activeDays} days`}
            value={rows.length ? tonnesFmt.format(dailyRate) : '—'}
            suffix="t / day"
            footnote="Net tonnes ÷ invoice dates with activity"
          />
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
              Negative tonne or value rows in this view. Not a margin figure.
            </p>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-8 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-base font-bold text-[#0c1543] flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-[#f26e22]" /> Revenue vs Volume Trajectory
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Delivered tonnes (navy bars) vs billed value (orange line). {period === 'all' || period === 'year' ? 'Monthly' : 'Daily'} buckets from the same view.
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs font-semibold">
                <span className="flex items-center gap-1 text-slate-700">
                  <span className="h-2.5 w-2.5 rounded bg-[#0c1543]" /> Sold Tonnes
                </span>
                <span className="flex items-center gap-1 text-slate-700">
                  <span className="h-2 w-2 rounded-full bg-[#f26e22]" /> Sales Value
                </span>
              </div>
            </div>
            <div className="h-56 w-full">
              {report.trend.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={report.trend} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
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
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        borderColor: '#e2e8f0',
                        borderRadius: '0.5rem',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                      }}
                      formatter={(val, name) => {
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
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <Empty loading={loading} />
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-4 shadow-sm">
            <h2 className="text-base font-bold text-[#0c1543] mb-1">Channel Share &amp; Yield</h2>
            <p className="text-xs text-slate-500 mb-3">Branch POS vs HQ Invoiced from the Power BI transaction type.</p>
            <div className="h-40">
              {report.channels.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={report.channels}
                      dataKey="tonnes"
                      nameKey="label"
                      innerRadius={48}
                      outerRadius={70}
                      paddingAngle={2}
                    >
                      {report.channels.map((item, idx) => (
                        <Cell key={item.label} fill={CHANNEL_COLORS[idx % CHANNEL_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(val, name) => [`${tonnesFmt.format(Number(val))} t`, String(name)]} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <Empty loading={loading} />
              )}
            </div>
            <div className="space-y-3 mt-1">
              {report.channels.map((ch, idx) => {
                const share = report.totalTonnes > 0 ? (ch.tonnes / report.totalTonnes) * 100 : 0;
                const chYield = ch.tonnes > 0 ? ch.value / ch.tonnes : 0;
                return (
                  <div key={ch.label} className="p-3 rounded-lg border border-slate-100 bg-slate-50/60">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800 flex items-center gap-1.5">
                        {idx === 0 ? (
                          <Building2 className="w-3.5 h-3.5 text-[#0c1543]" />
                        ) : (
                          <Store className="w-3.5 h-3.5 text-[#f26e22]" />
                        )}
                        {ch.label}
                      </span>
                      <span className="font-mono font-bold text-slate-800">
                        {tonnesFmt.format(ch.tonnes)} t ({share.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, Math.max(0, share))}%`,
                          background: CHANNEL_COLORS[idx % CHANNEL_COLORS.length],
                        }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                      <span>Revenue: {formatMoney(ch.value)}</span>
                      <span className="font-bold text-[#f26e22]">Yield: {formatMoney(chYield)}/t</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <h2 className="text-sm font-bold text-[#0c1543] uppercase tracking-wide">Product Category Mix</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                ReportingCategory from Power BI. Yield is billed value ÷ tonnes. Margin is not in this view.
              </p>
            </div>
            <div className="overflow-x-auto max-h-[360px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Category</th>
                    <th className="px-3 py-2 text-right">Volume (t)</th>
                    <th className="px-3 py-2 text-right">Sales Value</th>
                    <th className="px-3 py-2 text-right">Yield / t</th>
                    <th className="px-3 py-2 text-right">Mix %</th>
                  </tr>
                </thead>
                <tbody>
                  {report.categories.map((cat) => {
                    const mix = report.totalTonnes ? (cat.tonnes / report.totalTonnes) * 100 : 0;
                    const yieldPerT = cat.tonnes ? cat.value / cat.tonnes : 0;
                    return (
                      <tr key={cat.label} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-semibold text-slate-800">{cat.label}</td>
                        <td className="px-3 py-2 text-right font-mono">{tonnesFmt.format(cat.tonnes)}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatMoney(cat.value)}</td>
                        <td className="px-3 py-2 text-right font-mono text-[#f26e22]">{formatMoney(yieldPerT)}</td>
                        <td className="px-3 py-2 text-right font-mono">{mix.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                  {!report.categories.length && (
                    <tr>
                      <td colSpan={5} className="py-8">
                        <Empty loading={loading} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <h2 className="text-sm font-bold text-[#0c1543] uppercase tracking-wide">Depot &amp; Branch League</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Ranked by net tonnes. Share is of this filtered view — not a quota ring.
              </p>
            </div>
            <div className="overflow-x-auto max-h-[360px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Depot</th>
                    <th className="px-3 py-2 text-right">Volume (t)</th>
                    <th className="px-3 py-2 text-right">Billed Value</th>
                    <th className="px-3 py-2 text-right">Yield / t</th>
                    <th className="px-3 py-2 text-right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {report.branches.map((branch, idx) => {
                    const share = report.totalTonnes ? (branch.tonnes / report.totalTonnes) * 100 : 0;
                    const yieldPerT = branch.tonnes ? branch.value / branch.tonnes : 0;
                    return (
                      <tr key={branch.label} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <span className="mr-2 font-mono text-slate-400">{idx + 1}.</span>
                          <span className="font-semibold text-slate-800">{depotLabel(branch)}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{tonnesFmt.format(branch.tonnes)}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatMoney(branch.value)}</td>
                        <td className="px-3 py-2 text-right font-mono text-[#f26e22]">{formatMoney(yieldPerT)}</td>
                        <td className="px-3 py-2 text-right min-w-[110px]">
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-1.5 w-16 bg-slate-200 rounded-full overflow-hidden">
                              <div className="h-full bg-[#0c1543]" style={{ width: `${Math.min(100, Math.max(0, share))}%` }} />
                            </div>
                            <span className="font-mono w-12 text-right">{share.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!report.branches.length && (
                    <tr>
                      <td colSpan={5} className="py-8">
                        <Empty loading={loading} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-white flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#0c1543] bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                  Power BI Matrix
                </span>
                <h2 className="text-sm md:text-base font-bold text-[#0c1543] uppercase tracking-wide">
                  Tonnage by Category &amp; Branch
                </h2>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Cross-tab of {matrix.categories.length} reporting categories across {matrix.branches.length} branches.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs print:hidden">
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
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  value={matrixSearch}
                  onChange={(e) => setMatrixSearch(e.target.value)}
                  placeholder="Filter category..."
                  className="rounded-lg border border-slate-300 py-1 pl-8 pr-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#f26e22] w-40"
                />
              </div>
              <button
                type="button"
                onClick={exportMatrixCsv}
                className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <Download className="w-3.5 h-3.5 text-[#f26e22]" /> CSV
              </button>
            </div>
          </div>

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
                    matrixMetric === 'tonnes' ? matrix.catTotalsTonnes.get(cat) || 0 : matrix.catTotalsValue.get(cat) || 0;
                  return (
                    <tr key={cat} className={idx % 2 === 0 ? 'bg-white hover:bg-orange-50/40 transition' : 'bg-slate-50/50 hover:bg-orange-50/40 transition'}>
                      <td
                        className={`sticky left-0 z-10 px-3.5 py-2 font-sans font-semibold border-r border-slate-200 text-slate-900 whitespace-nowrap ${
                          idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'
                        }`}
                      >
                        {cat}
                      </td>
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
                      {matrixMetric === 'tonnes' ? tonnesFmt.format(report.totalTonnes) : formatMoney(report.totalValue)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span>
              Values shown in:{' '}
              <strong className="text-slate-800">
                {matrixMetric === 'tonnes' ? 'Metric Tonnes (t)' : 'Sales Amount (as billed)'}
              </strong>{' '}
              • Reversals highlighted in red.
            </span>
            <span>
              Grand Total:{' '}
              <strong className="text-[#0c1543] font-mono">{tonnesFmt.format(report.totalTonnes)} t</strong> |{' '}
              <strong className="text-[#f26e22] font-mono">{formatMoney(report.totalValue)}</strong>
            </span>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden print:hidden">
          <button
            type="button"
            onClick={() => setAuditOpen((open) => !open)}
            className="w-full p-4 flex items-center justify-between text-left hover:bg-slate-50"
          >
            <div>
              <h2 className="text-sm font-bold text-[#0c1543] uppercase tracking-wide flex items-center gap-2">
                {auditOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                Transactional Sales Audit Explorer
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Drill into the same imported Power BI rows used for the totals above.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500">{auditRows.length.toLocaleString()} rows</span>
          </button>
          {auditOpen && (
            <div className="border-t border-slate-200">
              <div className="p-3 flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Search depot, category, channel..."
                    className="rounded-lg border border-slate-300 py-1 pl-8 pr-2.5 text-xs w-64"
                  />
                </div>
              </div>
              <div className="overflow-x-auto max-h-[420px]">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="text-left text-slate-600">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Depot</th>
                      <th className="px-3 py-2">Channel</th>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2 text-right">Tonnes</th>
                      <th className="px-3 py-2 text-right">Value</th>
                      <th className="px-3 py-2 text-right">Lines</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditRows.slice(0, AUDIT_PAGE_SIZE).map((row) => (
                      <tr key={row.id} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 font-mono">{row.invoice_date}</td>
                        <td className="px-3 py-1.5">
                          {(row.warehouse_code || 'HQ').trim().toUpperCase()}
                          {row.warehouse_name ? ` · ${row.warehouse_name}` : ''}
                        </td>
                        <td className="px-3 py-1.5">{row.transaction_type}</td>
                        <td className="px-3 py-1.5">{row.reporting_category || row.category}</td>
                        <td className={`px-3 py-1.5 text-right font-mono ${Number(row.total_tonnes) < 0 ? 'text-rose-600' : ''}`}>
                          {tonnesFmt.format(Number(row.total_tonnes || 0))}
                        </td>
                        <td className={`px-3 py-1.5 text-right font-mono ${Number(row.total_sales_amount) < 0 ? 'text-rose-600' : ''}`}>
                          {formatMoney(Number(row.total_sales_amount || 0))}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">{row.line_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {auditRows.length > AUDIT_PAGE_SIZE && (
                <p className="p-3 text-xs text-slate-500">
                  Showing first {AUDIT_PAGE_SIZE} of {auditRows.length.toLocaleString()} matching rows. Narrow the period or search to reconcile Sage line-by-line.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function summarize(visible: Sale[], period: Period) {
  const channels = new Map<string, Summary>();
  const categories = new Map<string, Summary>();
  const branches = new Map<string, Summary>();
  const trend = new Map<string, { sort: string; label: string; tonnes: number; value: number }>();
  const activeDates = new Set<string>();
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
    activeDates.add(row.invoice_date);

    if (rowTonnes < 0 || rowValue < 0) {
      reversalsCount += 1;
      reversalValue += Math.abs(rowValue);
    }

    if (row.imported_at > latestImport) latestImport = row.imported_at;

    add(channels, row.transaction_type || 'Other', rowTonnes, rowValue);
    add(categories, category, rowTonnes, rowValue);
    add(branches, branch, rowTonnes, rowValue, row.warehouse_name);

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
    activeDays: activeDates.size,
    channels: [...channels.values()].sort((a, b) => b.tonnes - a.tonnes),
    categories: [...categories.values()].sort((a, b) => b.tonnes - a.tonnes),
    branches: [...branches.values()].sort((a, b) => b.tonnes - a.tonnes),
    trend: [...trend.values()].sort((a, b) => a.sort.localeCompare(b.sort)),
  };
}

function depotLabel(item: Summary) {
  return item.detail ? `${item.label} · ${item.detail}` : item.label;
}

function KpiCard(props: {
  title: string;
  badge: string;
  value: string;
  suffix?: string;
  footnote: string;
  change?: number | null;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between text-xs">
        <span className="font-bold uppercase tracking-wider text-slate-500">{props.title}</span>
        <span className="rounded bg-orange-50 px-2 py-0.5 font-bold text-[#f26e22] border border-orange-200">{props.badge}</span>
      </div>
      <div className="mt-2.5 flex items-baseline gap-2">
        <span className={`text-2xl lg:text-3xl font-extrabold font-mono ${props.accent ? 'text-[#f26e22]' : 'text-[#0c1543]'}`}>
          {props.value}
        </span>
        {props.suffix ? <span className="text-xs font-bold text-slate-500">{props.suffix}</span> : null}
      </div>
      {props.change != null && (
        <p className={`mt-1 text-[11px] font-semibold ${props.change >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
          {props.change >= 0 ? '+' : ''}
          {props.change.toFixed(1)}% vs prior equal period
        </p>
      )}
      <p className="mt-2 text-xs text-slate-500 border-t border-slate-100 pt-2">{props.footnote}</p>
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
        Day:{' '}
        <input type="date" value={props.day} min={props.sourceStart} max={props.sourceEnd} onChange={(e) => props.setDay(e.target.value)} className={common} />
      </label>
    );
  if (props.period === 'week')
    return (
      <label className="flex items-center gap-1 text-slate-500">
        Week End:{' '}
        <input type="date" value={props.weekEnding} min={props.sourceStart} max={props.sourceEnd} onChange={(e) => props.setWeekEnding(e.target.value)} className={common} />
      </label>
    );
  if (props.period === 'month')
    return (
      <label className="flex items-center gap-1 text-slate-500">
        Month:{' '}
        <input type="month" value={props.month} min={props.sourceStart.slice(0, 7)} max={props.sourceEnd.slice(0, 7)} onChange={(e) => props.setMonth(e.target.value)} className={common} />
      </label>
    );
  if (props.period === 'year')
    return (
      <label className="flex items-center gap-1 text-slate-500">
        Year:{' '}
        <select value={props.year} onChange={(e) => props.setYear(e.target.value)} className={common}>
          {props.years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
    );
  if (props.period === 'custom')
    return (
      <div className="flex items-center gap-1 text-slate-500">
        From:{' '}
        <input type="date" value={props.fromDate} min={props.sourceStart} max={props.sourceEnd} onChange={(e) => props.setFromDate(e.target.value)} className={common} />
        To:{' '}
        <input type="date" value={props.toDate} min={props.fromDate || props.sourceStart} max={props.sourceEnd} onChange={(e) => props.setToDate(e.target.value)} className={common} />
      </div>
    );
  return null;
}

function add(map: Map<string, Summary>, label: string, rowTonnes: number, rowValue: number, detail = '') {
  const item = map.get(label) || { label, detail, tonnes: 0, value: 0, rows: 0 };
  item.tonnes += rowTonnes;
  item.value += rowValue;
  item.rows += 1;
  if (!item.detail && detail) item.detail = detail;
  map.set(label, item);
}

function Empty({ loading }: { loading: boolean }) {
  return (
    <div className="grid min-h-28 place-items-center text-xs text-slate-400">
      {loading ? 'Loading Sage reporting data...' : 'No sales records match this view.'}
    </div>
  );
}
